/**
 * Domain logic for the serverless API: wallet auth, profiles, the $POG
 * economy and the online counter. Pure data access on top of `kv`, shared by
 * every handler in `api/` and by the local dev bridge in `server.ts`.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { kv } from './kv.js';
import { withWallet } from './lock.js';
import { holdingOf } from './chain.js';
import { humanGateOn, isVerified } from './human.js';
import {
  applyOffering,
  checkOffering,
  creditFrost,
  eligibility,
  indexFrost,
  normalizeFrost,
  pendingStreak,
  rollover,
  frostBoard,
  frostPool,
  seasonSummary,
  type FrostFields,
  type GateInput,
} from './season.js';
import { FROST, SEASON, multipliers, seasonState, shareOf } from '../../shared/season.js';
import {
  COIN,
  DAILY_QUESTS,
  GATHER,
  GATHER_PER_MIN,
  SWINGS_PER_MIN,
  IGLOO,
  PLAYER,
  RECIPES,
  RESOURCE_KEYS,
  SKINS,
  TOOL_LIFE,
  STREAK_BONUS_CAP,
  WORLD,
  canBuildAt,
  dailyQuests,
  fishById,
  getCoins,
  gatherYield,
  rollFish,
  skillLevel,
  getNode,
  questDay,
  skinById,
} from '../../shared/world.js';

export const SCARF_COLORS = [
  '#ff6b2c',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#f87171',
  '#e2e8f0',
];

export const K = {
  nonce: (wallet: string) => `pog:nonce:${wallet}`,
  session: (token: string) => `pog:sess:${token}`,
  profile: (wallet: string) => `pog:wallet:${wallet}`,
  names: 'pog:names', // lowercased name -> wallet
  leaderboard: 'pog:lb', // wallet -> $POG
  coins: 'pog:coins', // coinId -> timestamp it respawns at
  nodes: 'pog:nodes', // nodeId -> timestamp it respawns at
  igloos: 'pog:igloos', // wallet -> igloo JSON
  online: 'pog:online', // clientId -> last heartbeat
  rate: (wallet: string) => `pog:rate:${wallet}`,
  gatherRate: (wallet: string, kind: string) => `pog:rate:${kind}:${wallet}`,
  swingRate: (wallet: string) => `pog:swings:${wallet}`,
  /** swings landed on one node, cleared when it gives way or times out */
  hits: (wallet: string, nodeId: string) => `pog:hits:${wallet}:${nodeId}`,
  /** last position we accepted an action from, with its timestamp */
  track: (wallet: string) => `pog:track:${wallet}`,
  /** last minute of play credited, so playtime cannot be spammed upward */
  playTick: (wallet: string) => `pog:playtick:${wallet}`,
  /** today's quest progress, expiring on its own a few days later */
  quests: (wallet: string, day: string) => `pog:quests:${wallet}:${day}`,
  /** one key per reward, set atomically so a reward can only be taken once */
  questClaim: (wallet: string, day: string, id: string) => `pog:qc:${wallet}:${day}:${id}`,
  /** one bite per wallet per `biteMs`, whatever the client sends */
  bite: (wallet: string) => `pog:bite:${wallet}`,
  /** throttles the free jump home, so it cannot shortcut a farming route */
  homeJump: (wallet: string) => `pog:home:${wallet}`,
  /** and the jump back to the plaza, which is otherwise the same shortcut */
  spawnJump: (wallet: string) => `pog:spawn:${wallet}`,
  /** igloo listings, keyed by the seller's wallet */
  market: 'pog:market',
  /** a buyer holding an on-chain listing while they pay for it */
  reserve: (seller: string, listedAt: number) => `pog:resv:${seller}:${listedAt}`,
};

const NONCE_TTL = 5 * 60;
export const SESSION_TTL = 7 * 24 * 60 * 60;
const PROFILE_TTL = 365 * 24 * 60 * 60; // sliding — refreshed on every read
const ONLINE_WINDOW = 35_000;

/** A generous ceiling on coins per wallet per minute; honest play stays far under. */
const CLAIMS_PER_MIN = 12;

/* ------------------------------------------------------------------ *
 * Anti-automation
 *
 * The world is client-simulated, so the API cannot watch you play. What
 * it can do is refuse anything a real player could not have done:
 *
 *  - every action carries a position, and the position must be reachable
 *    from your previous action at running speed. A bot that jumps between
 *    resource nodes is rejected; one that walks between them legally pays
 *    the same travel time a player does.
 *  - actions have a minimum spacing, so a burst of requests fails even if
 *    it stays under the per-minute cap.
 *  - what a wallet may HOLD is tied to minutes actually played, credited
 *    at most one per real minute. A freshly created wallet cannot be
 *    pumped full of resources no matter how many requests it sends.
 *
 * None of this makes cheating impossible — a determined attacker can
 * simulate a player. It makes cheating no faster than playing, which is
 * the achievable goal without an authoritative server.
 * ------------------------------------------------------------------ */

/** Allowance for lag and client-side interpolation, in world units. */
const POSITION_SLACK = 260;
/** Shortest gap between two world actions from one wallet. */
const MIN_ACTION_GAP_MS = 800;
/** Starting allowance, then this much more per minute actually played. */
const HOLD_BASE = 120;
const HOLD_PER_MINUTE = 90;
/** At most one free jump to your own igloo per this many seconds. */
const HOME_JUMP_COOLDOWN_S = 60;
/**
 * Likewise the jump back to the plaza. Rejoining puts you there, and that
 * has to be allowed — but "I am at the plaza now" with no cooldown was a
 * free teleport to the cairn and the coins around it from anywhere on the
 * map. Nobody reloads the page more than once a minute by accident.
 */
const SPAWN_JUMP_COOLDOWN_S = 60;

interface Track {
  x: number;
  y: number;
  t: number;
}

/**
 * Did this wallet just respawn at its own igloo?
 *
 * Players who have built one spawn at their door instead of the plaza, so
 * that one jump has to be allowed. It is narrower than it sounds: the
 * destination is a single fixed point the player chose long ago, it can
 * never sit on a lake, and it is rate-limited — so it cannot be used to
 * shuttle between resource nodes.
 */
async function jumpedHome(wallet: string, x: number, y: number): Promise<boolean> {
  const store = await kv();
  const home = await store.hget<Igloo>(K.igloos, wallet);
  if (!home || !Number.isFinite(home.x)) return false;
  if (Math.hypot(x - home.x, y - home.y) > IGLOO.clearance) return false;
  return store.setnx(K.homeJump(wallet), Date.now(), HOME_JUMP_COOLDOWN_S);
}

/**
 * Accept an action at (x, y) only if the wallet could plausibly be there.
 * Returns an error string, or null when the move checks out.
 */
export async function trackMovement(
  wallet: string,
  x: number,
  y: number,
  minGapMs = MIN_ACTION_GAP_MS
): Promise<string | null> {
  const store = await kv();
  const now = Date.now();
  const last = await store.get<Track>(K.track(wallet));

  if (last) {
    if (now - last.t < minGapMs) return 'Slow down.';

    // Rejoining puts you back on the spawn plaza — or, once you have raised
    // one, at your own igloo door. Those jumps are legitimate, once a
    // minute. Everything else has to be walkable.
    const seconds = (now - last.t) / 1000;
    const reach = PLAYER.maxSpeed * PLAYER.iceSpeedBoost * seconds + POSITION_SLACK;
    if (Math.hypot(x - last.x, y - last.y) > reach) {
      const onPlaza = Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) <= WORLD.spawnRadius;
      const respawned =
        onPlaza && (await store.setnx(K.spawnJump(wallet), now, SPAWN_JUMP_COOLDOWN_S));
      if (!respawned && !(await jumpedHome(wallet, x, y))) {
        return 'You cannot be in two places at once.';
      }
    }
  }

  await store.set(K.track(wallet), { x, y, t: now }, { ex: 3600 });
  return null;
}

/** How much of a resource this wallet has earned the right to hold. */
export const holdCap = (profile: Profile) => HOLD_BASE + (profile.playMinutes || 0) * HOLD_PER_MINUTE;

export interface Profile extends FrostFields {
  wallet: string;
  name: string;
  color: string;
  /** cosmetic currency — only ever spent on skins */
  pog: number;
  wood: number;
  ice: number;
  fish: number;
  /** what the bears in the caves are worth; sold at the market, or offered at the cairn */
  gold: number;
  /** crafted things: rod, iglooKit */
  items: Record<string, number>;
  skins: string[];
  skin: string;
  /** minutes actually played, credited at most one per real minute */
  playMinutes: number;
  /**
   * Completed gathers per kind, which is all the XP there is. Levels and
   * yields are derived from these, never stored — a stored level would
   * drift the first time the curve was tuned.
   */
  skills: Record<string, number>;
  /** every species landed, by count — the tackle box */
  fishLog: Record<string, number>;
  /** gathers left on the tool currently in hand, per tool */
  wear: Record<string, number>;
  /** the one free axe, handed out once */
  starterAxe: boolean;
  /** consecutive days on which all three daily quests were cleared */
  streak: number;
  /** the last day that streak was extended, so it can lapse */
  lastQuestDay: string;
  createdAt: number;
  updatedAt: number;
}

export interface FurniturePiece {
  id: string;
  x: number;
  y: number;
}

export interface Igloo {
  wallet: string;
  owner: string;
  x: number;
  y: number;
  style: string;
  builtAt: number;
  /** what is standing inside, in room coordinates */
  furniture?: FurniturePiece[];
  /** when the daily yield was last settled */
  lastYield?: number;
  /**
   * What the owner has put away. Safe from the caves — a run that ends
   * badly empties the pack, never the igloo — but still counted against
   * the pack cap, so it is a place to keep things, not a way to hold more.
   */
  store?: Store;
}

export interface Store {
  wood: number;
  ice: number;
  fish: number;
  pog: number;
  gold: number;
  items: Record<string, number>;
}

export const emptyStore = (): Store => ({ wood: 0, ice: 0, fish: 0, pog: 0, gold: 0, items: {} });

/**
 * Only things the server itself hands out, only whole non-negative counts.
 * A negative count could only come from a lost update, and a stray key from
 * nowhere legitimate; neither should survive a read.
 */
function sanitizeItems(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(Object.hasOwn(ITEM_IDS, key) || key.startsWith('f_'))) continue;
    const n = Math.floor(Number(value) || 0);
    if (n > 0) out[key] = Math.min(10_000, n);
  }
  return out;
}

/** The crafted things a profile can hold — what the recipes give out. */
const ITEM_IDS: Record<string, true> = Object.fromEntries(
  Object.values(RECIPES).flatMap((r) => Object.keys(r.gives).filter((g) => !RESOURCE_KEYS.includes(g)).map((g) => [g, true]))
);

/** Only real species, only whole non-negative counts. */
function sanitizeFishLog(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!fishById(id)) continue;
    const n = Math.floor(Number(value) || 0);
    if (n > 0) out[id] = Math.min(1_000_000, n);
  }
  return out;
}

/** Uses left per tool that wears, whole and within the tool's life. */
function sanitizeWear(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [tool, life] of Object.entries(TOOL_LIFE)) {
    const n = Math.floor(Number((raw as Record<string, unknown>)[tool]) || 0);
    if (n > 0) out[tool] = Math.min(life, n);
  }
  return out;
}

/** Only the three known skills, only whole non-negative counts. */
function sanitizeSkills(raw: unknown): Record<string, number> {
  const out: Record<string, number> = { tree: 0, ice: 0, hole: 0 };
  if (raw && typeof raw === 'object') {
    for (const kind of Object.keys(out)) {
      const n = Math.floor(Number((raw as Record<string, unknown>)[kind]) || 0);
      out[kind] = Math.max(0, Math.min(1_000_000, n));
    }
  }
  return out;
}

/** Older records predate the inventory, so fill in whatever is missing. */
function normalize(p: Partial<Profile> & { wallet: string }): Profile {
  return {
    wallet: p.wallet,
    name: p.name ?? '',
    color: p.color ?? SCARF_COLORS[0],
    pog: Math.max(0, Math.floor(Number(p.pog) || 0)),
    wood: Math.max(0, Math.floor(Number(p.wood) || 0)),
    ice: Math.max(0, Math.floor(Number(p.ice) || 0)),
    fish: Math.max(0, Math.floor(Number(p.fish) || 0)),
    gold: Math.max(0, Math.floor(Number(p.gold) || 0)),
    items: sanitizeItems(p.items),
    skins: Array.isArray(p.skins) ? p.skins : ['default'],
    skin: typeof p.skin === 'string' ? p.skin : 'default',
    playMinutes: Math.max(0, Math.floor(Number(p.playMinutes) || 0)),
    skills: sanitizeSkills(p.skills),
    fishLog: sanitizeFishLog(p.fishLog),
    wear: sanitizeWear(p.wear),
    starterAxe: !!p.starterAxe,
    streak: Math.max(0, Math.floor(Number(p.streak) || 0)),
    lastQuestDay: typeof p.lastQuestDay === 'string' ? p.lastQuestDay : '',
    ...normalizeFrost(p),
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

/** Everything a profile is allowed to hold, capped so injection stays bounded. */
const CAPS: Record<string, number> = { pog: 1_000_000, wood: 20_000, ice: 20_000, fish: 20_000, gold: 100_000 };
const clampStock = (p: Profile) => {
  for (const k of Object.keys(CAPS)) {
    const key = k as 'pog' | 'wood' | 'ice' | 'fish' | 'gold';
    p[key] = Math.min(CAPS[k], Math.max(0, Math.floor(p[key])));
  }
  return p;
};

/* ------------------------------------------------------------------ *
 * Frost — the season ledger
 *
 * Every grant funnels through `grantFrost`. It is never reachable from a
 * request directly: the callers are `heartbeat`, `claimQuest`, `buildIgloo`
 * and `offerAtCairn`, all of which have already established that the thing
 * being rewarded actually happened.
 * ------------------------------------------------------------------ */

async function ownsIgloo(wallet: string): Promise<boolean> {
  const store = await kv();
  return (await store.hget<Igloo>(K.igloos, wallet)) != null;
}

/** The checklist inputs, gathered from the profile, the chain and the captcha. */
async function gateFor(profile: Profile): Promise<GateInput> {
  const [holding, human] = await Promise.all([holdingOf(profile.wallet), isVerified(profile.wallet)]);
  return {
    playMinutes: profile.playMinutes,
    playToday: profile.playToday,
    balance: holding.balance,
    chainLive: holding.live,
    humanRequired: humanGateOn(),
    humanVerified: human,
  };
}

/**
 * Bank `base` Frost against a profile, if the wallet qualifies and the
 * season is open. Mutates the profile; the caller still has to persist it
 * and then mirror the new total with `indexFrost`.
 *
 * Returns 0 for every ordinary reason — not qualified yet, season closed,
 * daily cap reached — because none of those are errors. A player who has
 * not passed the gate should still be able to play, quest and build; they
 * simply are not accruing yet.
 */
async function grantFrost(profile: Profile, base: number): Promise<number> {
  if (base <= 0) return 0;
  if (!seasonState().open) return 0;

  rollover(profile);
  const gate = await gateFor(profile);
  if (!eligibility(gate).ok) return 0;

  const mult = multipliers({
    streakDays: pendingStreak(profile),
    hasIgloo: await ownsIgloo(profile.wallet),
    balance: gate.balance,
  });
  return creditFrost(profile, base, mult.total).banked;
}

/** Persist a profile and mirror its Frost into the season index. */
async function saveWithFrost(profile: Profile, banked: number): Promise<Profile> {
  const saved = await putProfile(profile);
  if (banked > 0) await indexFrost(saved.wallet, saved.frost, banked);
  return saved;
}

export interface FrostEntry {
  rank: number;
  name: string;
  color: string;
  frost: number;
  /** what this rank takes if the season ended right now */
  tokens: number;
}

/** The season board, with names and a running estimate of each share. */
export async function frostLeaderboard(limit = 25): Promise<FrostEntry[]> {
  const [rows, pool] = await Promise.all([frostBoard(limit), frostPool()]);
  if (!rows.length) return [];

  const store = await kv();
  const profiles = await store.mget<Profile>(rows.map((r) => K.profile(r.wallet)));
  return rows
    .map((r, i) => ({ r, p: profiles[i] }))
    .filter(({ p }) => !!p?.name)
    .map(({ r, p }, i) => ({
      rank: i + 1,
      name: p!.name,
      color: p!.color,
      frost: r.frost,
      tokens: shareOf(r.frost, pool).tokens,
    }));
}

/** The whole season panel for one wallet. */
export async function seasonFor(wallet: string) {
  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  rollover(profile);
  const gate = await gateFor(profile);
  return seasonSummary(wallet, profile, gate, await ownsIgloo(wallet));
}

/**
 * Burn resources at the cairn for Frost.
 *
 * Unlike crafting, this one is position-checked. Frost is the thing worth
 * scripting, so it is worth making a script walk to the plaza and stand
 * there like everyone else.
 */
export const offerAtCairn = (wallet: string, offeringId: unknown, x: unknown, y: unknown) =>
  withWallet(wallet, () => offerAtCairnNow(wallet, offeringId, x, y));

async function offerAtCairnNow(
  wallet: string,
  offeringId: unknown,
  x: unknown,
  y: unknown
): Promise<{ profile?: Profile; frost?: number; spent?: Record<string, number>; error?: string }> {
  if (!seasonState().open) return { error: 'The season is closed.' };

  const cairn = getNode('station-cairn');
  const px = Number(x);
  const py = Number(y);
  if (!cairn) return { error: 'The cairn is not there.' };
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { error: 'Where are you?' };
  if (Math.hypot(px - cairn.x, py - cairn.y) > GATHER.range * 1.6) {
    return { error: 'Bring it to the cairn on the plaza.' };
  }

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  rollover(profile);
  const gate = await gateFor(profile);
  const check = eligibility(gate);
  if (!check.ok) {
    const missing = check.items.find((i) => !i.done);
    return { error: `Not eligible yet — ${missing?.label.toLowerCase()}.` };
  }

  // Everything that can refuse this runs before the movement check, so a
  // bad id or an empty pack costs nothing and the rate limiter never ends
  // up answering on behalf of a validation that did not happen.
  const precheck = checkOffering(profile, offeringId);
  if (precheck.error) return { error: precheck.error };

  const moveError = await trackMovement(wallet, px, py);
  if (moveError) return { error: moveError };

  const mult = multipliers({
    streakDays: pendingStreak(profile),
    hasIgloo: await ownsIgloo(wallet),
    balance: gate.balance,
  });

  const result = applyOffering(profile, offeringId, mult.total);
  if (result.error) return { error: result.error };

  return {
    profile: await saveWithFrost(profile, result.credit!.banked),
    frost: result.credit!.banked,
    spent: result.spent,
  };
}

/**
 * Hand a profile resources, for local testing only. Reached solely from
 * `api/dev`, which is off unless POG_DEV_KEY is set and refuses to exist
 * on a production deployment.
 *
 * Note what is NOT here: frost, frostStreak, playMinutes, playToday. A
 * shortcut for testing the igloo must not also be a shortcut past the
 * airdrop gate, so the fields that decide who gets paid are unreachable
 * from this path — the allow-list below is the whole of it.
 */
export const devGrant = (wallet: string, gift: Record<string, unknown>) =>
  withWallet(wallet, () => devGrantNow(wallet, gift));

async function devGrantNow(
  wallet: string,
  gift: Record<string, unknown>
): Promise<{ profile?: Profile; granted?: Record<string, number>; error?: string }> {
  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  const granted: Record<string, number> = {};

  for (const key of ['wood', 'ice', 'fish', 'pog', 'gold'] as const) {
    const amount = Math.floor(Number(gift[key]) || 0);
    if (amount > 0) {
      profile[key] += amount;
      granted[key] = amount;
    }
  }

  // items are named by the recipes, so only those ids can be conjured
  const items = gift.items;
  if (items && typeof items === 'object') {
    for (const [id, raw] of Object.entries(items as Record<string, unknown>)) {
      if (!Object.hasOwn(RECIPES, id)) continue;
      const give = Object.keys(RECIPES[id as keyof typeof RECIPES].gives)[0];
      const amount = Math.floor(Number(raw) || 0);
      if (amount > 0) {
        profile.items[give] = (profile.items[give] || 0) + amount;
        granted[give] = amount;
      }
    }
  }

  return { profile: await putProfile(profile), granted };
}

/* ------------------------------------------------------------------ *
 * Wallet auth (Solana ed25519 over a plain-text message)
 * ------------------------------------------------------------------ */

export function loginMessage(nonce: string): string {
  return [
    'POG — Sign in to the frozen world',
    '',
    'Signing this message proves you own this wallet.',
    'It is free, off-chain, and never moves your funds.',
    '',
    'nonce: ' + nonce,
  ].join('\n');
}

export function isValidWallet(wallet: unknown): wallet is string {
  try {
    return typeof wallet === 'string' && bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function issueNonce(wallet: string): Promise<string> {
  const nonce = randomHex(16);
  const store = await kv();
  await store.set(K.nonce(wallet), nonce, { ex: NONCE_TTL });
  return nonce;
}

/** Verifies the signature against a nonce we issued, then burns the nonce. */
export async function verifyLogin(wallet: string, signatureB58: string): Promise<string | null> {
  const store = await kv();
  const nonce = await store.get<string>(K.nonce(wallet));
  if (!nonce) return null;

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(loginMessage(nonce)),
      bs58.decode(signatureB58),
      bs58.decode(wallet)
    );
  } catch {
    ok = false;
  }
  if (!ok) return null;

  await store.del(K.nonce(wallet));
  const token = randomHex(32);
  await store.set(K.session(token), wallet, { ex: SESSION_TTL });
  return token;
}

export async function walletForToken(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 16) return null;
  const store = await kv();
  return (await store.get<string>(K.session(token))) ?? null;
}

export async function dropSession(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  (await kv()).del(K.session(token));
}

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

const NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ .-]{1,15}$/;

export function validateName(raw: unknown): { name?: string; error?: string } {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) {
    return { error: 'Names are 2-16 characters: letters, numbers, _ . - and spaces.' };
  }
  return { name };
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  const store = await kv();
  const raw = await store.get<Partial<Profile>>(K.profile(wallet));
  if (!raw) return null;
  const p = normalize({ ...raw, wallet });
  if (!p.starterAxe) {
    // the one tool nobody has to earn, or wood could never be had
    p.starterAxe = true;
    p.items.axe = (p.items.axe || 0) + 1;
  }
  await store.set(K.profile(wallet), p, { ex: PROFILE_TTL }); // sliding expiry
  return p;
}

export const putProfile = async (p: Profile) => {
  p.updatedAt = Date.now();
  clampStock(p);
  const store = await kv();
  await store.set(K.profile(p.wallet), p, { ex: PROFILE_TTL });
  return p;
};

export async function nameOwner(name: string): Promise<string | null> {
  const store = await kv();
  return (await store.hget<string>(K.names, name.toLowerCase())) ?? null;
}

export const saveProfile = (wallet: string, name: string, color: string) =>
  withWallet(wallet, () => saveProfileNow(wallet, name, color));

async function saveProfileNow(
  wallet: string,
  name: string,
  color: string
): Promise<{ profile?: Profile; error?: string }> {
  const store = await kv();
  const lower = name.toLowerCase();

  const existing = await store.get<Partial<Profile>>(K.profile(wallet));
  const keeping = existing?.name?.toLowerCase() === lower;

  // Claim the name atomically. Check-then-set here let two wallets racing
  // for the same name both win it, and the board then showed one name for
  // two penguins.
  if (!keeping && !(await store.hsetnx(K.names, lower, wallet))) {
    const owner = await store.hget<string>(K.names, lower);
    if (owner !== wallet) return { error: 'That name is already taken.' };
  }

  const profile = normalize({
    ...(existing ?? {}),
    wallet,
    name,
    color: SCARF_COLORS.includes(color) ? color : SCARF_COLORS[0],
  });

  // release the previous name so it becomes available again
  if (existing?.name && !keeping) {
    await store.hdel(K.names, existing.name.toLowerCase());
  }

  await store.set(K.profile(wallet), profile, { ex: PROFILE_TTL });
  await store.zadd(K.leaderboard, profile.pog, wallet);
  return { profile };
}

/* ------------------------------------------------------------------ *
 * $POG pickups
 * ------------------------------------------------------------------ */

/** Coin ids currently held by somebody, so a joining client hides them too. */
export async function takenCoins(): Promise<number[]> {
  const store = await kv();
  const now = Date.now();
  await store.zremRangeByScore(K.coins, 0, now);
  const ids = await store.zrangeByScore(K.coins, now, Number.MAX_SAFE_INTEGER);
  return ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
}

export const claimCoin = (wallet: string, coinId: number, x?: unknown, y?: unknown) =>
  withWallet(wallet, () => claimCoinNow(wallet, coinId, x, y));

async function claimCoinNow(
  wallet: string,
  coinId: number,
  x?: unknown,
  y?: unknown
): Promise<{ pog?: number; error?: string }> {
  const coins = getCoins() as Array<{ id: number; x: number; y: number }>;
  if (!Number.isInteger(coinId) || coinId < 0 || coinId >= coins.length) {
    return { error: 'No such coin.' };
  }

  // The claimed position has to be next to the coin, and reachable from
  // wherever this wallet last acted. A claim with no position at all used
  // to skip both checks — every coin on the map, from anywhere, at the
  // per-minute cap. There is no honest reason to omit it.
  const coin = coins[coinId];
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { error: 'Where are you?' };
  if (Math.hypot(px - coin.x, py - coin.y) > COIN.pickupRadius * 2) {
    return { error: 'Too far from that coin.' };
  }
  const moveError = await trackMovement(wallet, px, py);
  if (moveError) return { error: moveError };

  const store = await kv();

  // rate limit before touching anything else
  const hits = await store.incrWithTtl(K.rate(wallet), 60);
  if (hits > CLAIMS_PER_MIN) return { error: 'Slow down.' };

  const now = Date.now();
  await store.zremRangeByScore(K.coins, 0, now);
  const won = await store.zaddnx(K.coins, now + COIN.respawnMs, String(coinId));
  if (!won) return { error: 'Someone else grabbed it.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  profile.pog += COIN.value;
  await putProfile(profile);
  await store.zadd(K.leaderboard, profile.pog, wallet);
  await bumpQuest(wallet, 'coin', 1);
  return { pog: profile.pog };
}

/* ------------------------------------------------------------------ *
 * Gathering
 *
 * The API cannot see where you are standing — presence is peer-to-peer.
 * What it can do is check the node is real, that you claimed a position
 * within reach of it, that the node is not on cooldown, and that your
 * wallet is not pulling more per minute than a human could. That bounds
 * the damage a script can do without pretending we have authority we do
 * not have.
 * ------------------------------------------------------------------ */

export interface GatherResult {
  /** swings landed on this node so far, and how many it takes */
  hits?: number;
  needed?: number;
  /** only present on the swing that finally fells it */
  profile?: Profile;
  gained?: Record<string, number>;
  respawnAt?: number;
  /** fishing: what bit, or that it got away */
  catch?: { id: string; label: string; rarity: string };
  escaped?: boolean;
  /** the tool that just wore out on this gather, if one did */
  broke?: string;
  error?: string;
}

export const gather = (wallet: string, nodeId: unknown, x: unknown, y: unknown) =>
  withWallet(wallet, () => gatherNow(wallet, nodeId, x, y));

async function gatherNow(
  wallet: string,
  nodeId: unknown,
  x: unknown,
  y: unknown
): Promise<GatherResult> {
  const node = typeof nodeId === 'string' ? getNode(nodeId) : null;
  if (!node) return { error: 'No such spot.' };

  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { error: 'Where are you?' };
  if (Math.hypot(px - node.x, py - node.y) > GATHER.range * 1.6) {
    return { error: 'Too far away.' };
  }

  // one shape for all three node kinds; only fishing carries a `needs`
  const rule = (Object.hasOwn(GATHER, node.type) ? GATHER[node.type as 'tree' | 'ice' | 'hole'] : undefined) as
    | { yields: Record<string, number>; respawnMs: number; hits: number; needs?: string; biteMs?: number }
    | undefined;
  if (!rule) return { error: 'Nothing to do here.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  if (rule.needs && !(profile.items[rule.needs] > 0)) {
    const name = rule.needs === 'rod' ? 'fishing rod' : rule.needs === 'pick' ? 'ice pick' : rule.needs;
    return { error: `You need an ${name} for that.`.replace('an fishing', 'a fishing') };
  }

  const store = await kv();
  const now = Date.now();

  // nothing to swing at if someone already felled it
  await store.zremRangeByScore(K.nodes, 0, now);
  const cooling = await store.zrangeByScore(K.nodes, now, Number.MAX_SAFE_INTEGER);
  if (cooling.includes(node.id)) return { error: 'Someone just worked this spot.' };

  // A swing is an action like any other: you must be in range, and you must
  // have been able to walk here. The gap is shorter than for other actions
  // because swinging is meant to be a rhythm, not a single click.
  const moveError = await trackMovement(wallet, px, py, Math.floor(GATHER.swingMs * 0.6));
  if (moveError) return { error: moveError };

  // bound raw swings separately from completed gathers
  const swings = await store.incrWithTtl(K.swingRate(wallet), 60);
  if (swings > SWINGS_PER_MIN) return { error: 'Catch your breath.' };

  // Fishing is on a clock, not a count: one bite per wallet per biteMs,
  // held as a lock that is never released so it expires exactly on time.
  // A client asking early is told to wait; it cannot make the fish hurry.
  if (rule.biteMs) {
    const bite = await store.lock(K.bite(wallet), rule.biteMs - 350);
    if (!bite) return { error: 'Nothing is biting yet.' };
  }

  // Count the blow. Half-finished work expires, so you cannot chip a tree
  // now and come back in an hour to collect it.
  const needed = Math.max(1, rule.hits || 1);
  const landed = needed > 1 ? await store.incrWithTtl(K.hits(wallet, node.id), 90) : 1;
  if (landed < needed) return { hits: landed, needed };

  // The felling blow: now the expensive checks apply.
  const perMin = GATHER_PER_MIN[node.type as keyof typeof GATHER_PER_MIN] ?? 20;
  const completions = await store.incrWithTtl(K.gatherRate(wallet, node.type), 60);
  if (completions > perMin) {
    await store.del(K.hits(wallet, node.id));
    return { error: 'Catch your breath.' };
  }

  const cap = holdCap(profile);
  const held = profile.wood + profile.ice + profile.fish;
  if (held >= cap) {
    await store.del(K.hits(wallet, node.id));
    return { error: 'Your pack is as full as your playtime allows. Keep playing to carry more.' };
  }

  // A node that respawns is claimed atomically, so two players cannot both
  // bank the same tree. A hole never depletes; the bite clock is its limit.
  const respawnAt = Date.now() + rule.respawnMs;
  if (rule.respawnMs > 0) {
    if (!(await store.zaddnx(K.nodes, respawnAt, node.id))) {
      await store.del(K.hits(wallet, node.id));
      return { error: 'Someone just worked this spot.' };
    }
    await store.del(K.hits(wallet, node.id));
  }

  // What it gives depends on how good you are at this. The count is read
  // before the increment, so the level you had when you swung is the
  // level that pays — not the one you reach by landing the blow.
  const count = profile.skills[node.type] || 0;
  const gained = gatherYield(node.type, count) as Record<string, number>;

  // Fishing rolls the table here, with the server's dice. The skill bonus
  // rides on top of whatever bit; nothing bit, nothing gained, no XP.
  let landedFish: { id: string; label: string; rarity: string } | undefined;
  if (rule.biteMs) {
    const species = rollFish(skillLevel(count).level);
    if (!species) return { escaped: true, respawnAt, hits: needed, needed };
    gained.fish = species.fish + (gained.fish - rule.yields.fish);
    landedFish = { id: species.id, label: species.label, rarity: species.rarity };
    profile.fishLog[species.id] = (profile.fishLog[species.id] || 0) + 1;
  }

  for (const [res, amount] of Object.entries(gained)) {
    profile[res as 'wood' | 'ice' | 'fish'] += amount;
  }
  profile.skills[node.type] = (profile.skills[node.type] || 0) + 1;

  // The tool wears with every completed gather. When it is spent it goes,
  // and the next one in the pack (if any) starts fresh.
  let broke: string | undefined;
  const tool = rule.needs;
  if (tool && Object.hasOwn(TOOL_LIFE, tool)) {
    const left = (profile.wear[tool] || TOOL_LIFE[tool as keyof typeof TOOL_LIFE]) - 1;
    if (left <= 0) {
      profile.items[tool] -= 1;
      if (profile.items[tool] <= 0) delete profile.items[tool];
      delete profile.wear[tool];
      broke = tool;
    } else {
      profile.wear[tool] = left;
    }
  }

  const saved = await putProfile(profile);
  await bumpQuest(wallet, node.type, 1);
  return { profile: saved, gained, respawnAt, hits: needed, needed, catch: landedFish, broke };
}

/** Node ids currently on cooldown, so a joining client hides them too. */
export async function depletedNodes(): Promise<string[]> {
  const store = await kv();
  const now = Date.now();
  await store.zremRangeByScore(K.nodes, 0, now);
  return store.zrangeByScore(K.nodes, now, Number.MAX_SAFE_INTEGER);
}

/* ------------------------------------------------------------------ *
 * Crafting
 * ------------------------------------------------------------------ */

export const craft = (wallet: string, recipeId: unknown) =>
  withWallet(wallet, () => craftNow(wallet, recipeId));

async function craftNow(wallet: string, recipeId: unknown): Promise<{ profile?: Profile; error?: string }> {
  // Object.hasOwn, not a bare lookup: RECIPES['__proto__'] is truthy and
  // would sail past a !recipe check straight into a crash.
  const recipe =
    typeof recipeId === 'string' && Object.hasOwn(RECIPES, recipeId)
      ? RECIPES[recipeId as keyof typeof RECIPES]
      : null;
  if (!recipe) return { error: 'No such recipe.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  for (const [res, need] of Object.entries(recipe.cost)) {
    const key = res as 'wood' | 'ice' | 'fish' | 'pog';
    if (profile[key] < (need as number)) return { error: `Not enough ${res}.` };
  }
  for (const [res, need] of Object.entries(recipe.cost)) {
    const key = res as 'wood' | 'ice' | 'fish' | 'pog';
    profile[key] -= need as number;
  }
  // A recipe pays out either a crafted item or a resource the profile
  // already tracks — the cookout turns fish straight into $POG.
  for (const [give, amount] of Object.entries(recipe.gives)) {
    if (RESOURCE_KEYS.includes(give)) {
      profile[give as 'pog' | 'wood' | 'ice' | 'fish'] += amount as number;
    } else {
      profile.items[give] = (profile.items[give] || 0) + (amount as number);
    }
  }

  const saved = await putProfile(profile);
  if (Object.hasOwn(recipe.gives, 'pog')) {
    await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
  }
  await bumpQuest(wallet, 'craft', 1);
  return { profile: saved };
}

/* ------------------------------------------------------------------ *
 * Daily quests
 *
 * Three a day, recomputed server-side from the wallet and the UTC date —
 * the client never tells us which quests it has. Progress is only ever
 * incremented from inside gather/craft/claim, so it inherits every rate
 * cap those already enforce; a reward is handed out at most once because
 * the claim is gated on an atomic setnx rather than on a list we read,
 * modified and wrote back.
 * ------------------------------------------------------------------ */

const QUEST_TTL = 3 * 24 * 60 * 60;

/**
 * Only progress is stored as a document. Whether a reward has been taken
 * lives in one key per quest instead, created with setnx — read-modify-write
 * on a `claimed` array would lose an entry when two claims race, and the
 * streak would then never see all three as done.
 */
interface QuestProgress {
  progress: Record<string, number>;
}

export interface QuestView {
  id: string;
  label: string;
  icon: string;
  reward: number;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface QuestBoard {
  day: string;
  quests: QuestView[];
  streak: number;
  /** what finishing the last one today is additionally worth */
  streakBonus: number;
  claimable: number;
}

async function readQuests(wallet: string, day: string): Promise<QuestProgress> {
  const store = await kv();
  const raw = await store.get<Partial<QuestProgress>>(K.quests(wallet, day));
  return { progress: raw?.progress && typeof raw.progress === 'object' ? raw.progress : {} };
}

/** Which of `ids` have already paid out today, straight from the claim keys. */
async function claimedIds(wallet: string, day: string, ids: string[]): Promise<Set<string>> {
  const store = await kv();
  const marks = await store.mget<unknown>(ids.map((id) => K.questClaim(wallet, day, id)));
  return new Set(ids.filter((_, i) => marks[i] != null));
}

/** Yesterday, in the same UTC calendar the quests roll over on. */
const previousDay = (day: string) => questDay(Date.parse(day + 'T00:00:00Z') - 86_400_000);

/**
 * Record progress against whichever of today's quests tracks `what`.
 * Called from the actions themselves, never from a request the client
 * can shape, so there is nothing here to forge.
 */
async function bumpQuest(wallet: string, what: string, amount: number): Promise<void> {
  const day = questDay();
  const todays = dailyQuests(wallet, day).filter((q) => q.track === what);
  if (!todays.length) return;

  const store = await kv();
  const state = await readQuests(wallet, day);
  for (const q of todays) {
    state.progress[q.id] = Math.min(q.target, (state.progress[q.id] || 0) + amount);
  }
  await store.set(K.quests(wallet, day), state, { ex: QUEST_TTL });
}

export async function questBoard(wallet: string): Promise<QuestBoard> {
  const day = questDay();
  const defs = dailyQuests(wallet, day);
  const [state, profile, claimed] = await Promise.all([
    readQuests(wallet, day),
    getProfile(wallet),
    claimedIds(wallet, day, defs.map((q) => q.id)),
  ]);

  const quests: QuestView[] = defs.map((q) => ({
    id: q.id,
    label: q.label,
    icon: q.icon,
    reward: q.reward,
    target: q.target,
    progress: Math.min(q.target, state.progress[q.id] || 0),
    claimed: claimed.has(q.id),
  }));

  // A streak that was not extended yesterday has already lapsed, so show 0
  // rather than a number the player can no longer build on.
  const last = profile?.lastQuestDay || '';
  const live = last === day || last === previousDay(day);
  const streak = live ? profile?.streak || 0 : 0;

  return {
    day,
    quests,
    streak,
    streakBonus: Math.min(STREAK_BONUS_CAP, streak + 1),
    claimable: quests.filter((q) => !q.claimed && q.progress >= q.target).length,
  };
}

export const claimQuest = (wallet: string, questId: unknown) =>
  withWallet(wallet, () => claimQuestNow(wallet, questId));

async function claimQuestNow(
  wallet: string,
  questId: unknown
): Promise<{ profile?: Profile; reward?: number; bonus?: number; streak?: number; frost?: number; error?: string }> {
  const day = questDay();
  const defs = dailyQuests(wallet, day);
  const def = defs.find((q) => q.id === questId);
  if (!def) return { error: 'That is not one of today’s quests.' };

  const state = await readQuests(wallet, day);
  if ((state.progress[def.id] || 0) < def.target) return { error: 'Not finished yet.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  const store = await kv();
  // The atomic gate. Two requests racing here: exactly one creates the key.
  if (!(await store.setnx(K.questClaim(wallet, day, def.id), Date.now(), QUEST_TTL))) {
    return { error: 'Already claimed.' };
  }

  const claimed = await claimedIds(wallet, day, defs.map((q) => q.id));

  let bonus = 0;
  // Clearing the last one extends the streak — once per day, and only if
  // yesterday was the last day it moved.
  if (claimed.size >= Math.min(DAILY_QUESTS, defs.length) && profile.lastQuestDay !== day) {
    profile.streak = profile.lastQuestDay === previousDay(day) ? profile.streak + 1 : 1;
    profile.lastQuestDay = day;
    bonus = Math.min(STREAK_BONUS_CAP, profile.streak);
  }

  profile.pog += def.reward + bonus;

  // Frost for the quest, plus the sweep bonus on the one that finishes the set.
  const sweep = claimed.size >= Math.min(DAILY_QUESTS, defs.length);
  const frost = await grantFrost(profile, FROST.quest + (sweep ? FROST.questSweep : 0));

  const saved = await saveWithFrost(profile, frost);
  await store.zadd(K.leaderboard, saved.pog, wallet);
  return { profile: saved, reward: def.reward, bonus, streak: saved.streak, frost };
}

/* ------------------------------------------------------------------ *
 * Igloos — the one part of the world players author themselves
 * ------------------------------------------------------------------ */

export async function listIgloos(): Promise<Igloo[]> {
  const store = await kv();
  const all = await store.hgetall<Igloo>(K.igloos);
  return Object.values(all || {}).filter((i) => i && Number.isFinite(i.x));
}

export const buildIgloo = (wallet: string, x: unknown, y: unknown, style: unknown) =>
  withWallet(wallet, () => buildIglooNow(wallet, x, y, style));

async function buildIglooNow(
  wallet: string,
  x: unknown,
  y: unknown,
  style: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; frost?: number; error?: string }> {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { error: 'Where are you?' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  if (!(profile.items.iglooKit > 0)) return { error: 'Craft an igloo kit first.' };

  // Same rule set the client previews with, so the ghost never lies.
  const store = await kv();
  const existing = await listIgloos();
  const others = existing.filter((i) => i.wallet !== wallet);
  const spot = canBuildAt(px, py, others);
  if (!spot.ok) return { error: spot.reason };

  // Raising a second one moves you, furniture and all — it used to
  // silently replace the igloo and everything standing in it. Not while it
  // is for sale, though: a buyer is paying for the plot they looked at.
  const mine = existing.find((i) => i.wallet === wallet) ?? null;
  if (mine && (await store.hget(K.market, wallet)) != null) {
    return { error: 'Take it off the market before moving it.' };
  }

  const moveError = await trackMovement(wallet, px, py);
  if (moveError) return { error: moveError };

  const igloo: Igloo = {
    wallet,
    owner: profile.name,
    x: Math.round(px),
    y: Math.round(py),
    style: IGLOO.styles.includes(style as string) ? (style as string) : IGLOO.styles[0],
    builtAt: mine?.builtAt ?? Date.now(),
    furniture: mine?.furniture ?? [],
    lastYield: mine?.lastYield ?? Date.now(),
  };

  profile.items.iglooKit -= 1;
  await store.hset(K.igloos, wallet, igloo);

  // One Frost award per season for raising a shelter — after the hset, so
  // the igloo multiplier already counts the one just built.
  let frost = 0;
  if (profile.iglooFrostSeason !== SEASON.id) {
    frost = await grantFrost(profile, FROST.igloo);
    if (frost > 0) profile.iglooFrostSeason = SEASON.id;
  }

  return { igloo, profile: await saveWithFrost(profile, frost), frost };
}

/* ------------------------------------------------------------------ *
 * Skin shop — the only $POG sink
 * ------------------------------------------------------------------ */

export const buySkin = (wallet: string, skinId: unknown) => withWallet(wallet, () => buySkinNow(wallet, skinId));

async function buySkinNow(wallet: string, skinId: unknown): Promise<{ profile?: Profile; error?: string }> {
  const skin = SKINS.find((s: { id: string }) => s.id === skinId);
  if (!skin) return { error: 'No such skin.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  if (profile.skins.includes(skin.id)) return { error: 'You already own that.' };
  if (profile.pog < skin.price) return { error: `That costs ${skin.price} P coins.` };

  profile.pog -= skin.price;
  profile.skins.push(skin.id);
  profile.skin = skin.id;
  return { profile: await putProfile(profile) };
}

export const equipSkin = (wallet: string, skinId: unknown) =>
  withWallet(wallet, () => equipSkinNow(wallet, skinId));

async function equipSkinNow(wallet: string, skinId: unknown): Promise<{ profile?: Profile; error?: string }> {
  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  const skin = skinById(skinId);
  if (!profile.skins.includes(skin.id)) return { error: 'You do not own that skin.' };
  profile.skin = skin.id;
  return { profile: await putProfile(profile) };
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  color: string;
  pog: number;
}

export async function leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  const store = await kv();
  const top = await store.ztop(K.leaderboard, limit);
  if (!top.length) return [];

  const profiles = await store.mget<Profile>(top.map((t) => K.profile(t.member)));
  return top
    .map((t, i) => ({ t, p: profiles[i] }))
    .filter(({ p }) => !!p?.name)
    .map(({ t, p }, i) => ({
      rank: i + 1,
      name: p!.name,
      color: p!.color,
      pog: Math.round(t.score),
    }));
}

/* ------------------------------------------------------------------ *
 * Online counter
 *
 * A server-side backstop for the MQTT presence count, which can dip when the
 * public broker hiccups or a client is mid-reconnect. The UI shows whichever
 * number is higher.
 * ------------------------------------------------------------------ */

/** Distinct penguins one address may keep on the counter per minute. */
const BEATS_PER_IP_MIN = 40;

export async function heartbeat(clientId: string, wallet?: string | null, ip = ''): Promise<number> {
  const store = await kv();
  const now = Date.now();

  // A signed-in player counts as their wallet, whatever id they send; a
  // guest counts as their id, but only so many guests per address.
  const member = wallet ? 'w:' + wallet : 'g:' + clientId.slice(0, 64);
  const beats = ip ? await store.incrWithTtl(`pog:beatip:${ip}`, 60) : 0;
  if (wallet || beats <= BEATS_PER_IP_MIN) await store.zadd(K.online, now, member);
  await store.zremRangeByScore(K.online, 0, now - ONLINE_WINDOW);

  // Credit playtime at most once per real minute, gated by a key with a
  // 55s TTL. Spamming heartbeats buys nothing; only elapsed time does.
  if (wallet) {
    const fresh = await store.setnx(K.playTick(wallet), now, 55);
    if (fresh) {
      // Under the wallet lock like every other profile write: a heartbeat
      // lands every half minute, and one that read the profile just before
      // a gather wrote it would put the old pack back.
      await withWallet(wallet, async () => {
        const profile = await getProfile(wallet);
        if (!profile) return;
        rollover(profile);
        profile.playMinutes = Math.min(100_000, (profile.playMinutes || 0) + 1);
        profile.playToday = Math.min(1440, profile.playToday + 1);

        // Frost for time on the ice, in blocks. `playToday` moves one at a
        // time and only on a real elapsed minute, so testing the boundary
        // is exact and needs no separate "blocks paid" counter.
        let banked = 0;
        const block = profile.playToday / FROST.playBlockMinutes;
        if (Number.isInteger(block) && block <= FROST.maxPlayBlocks) {
          banked = await grantFrost(profile, FROST.perPlayBlock);
        }
        await saveWithFrost(profile, banked);
      });
    }
  }

  return store.zcard(K.online);
}

export async function onlineCount(): Promise<number> {
  const store = await kv();
  const now = Date.now();
  await store.zremRangeByScore(K.online, 0, now - ONLINE_WINDOW);
  return store.zcard(K.online);
}

export async function walletCount(): Promise<number> {
  const store = await kv();
  return store.zcard(K.leaderboard);
}
