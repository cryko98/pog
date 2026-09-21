/**
 * Domain logic for the serverless API: wallet auth, profiles, the $POG
 * economy and the online counter. Pure data access on top of `kv`, shared by
 * every handler in `api/` and by the local dev bridge in `server.ts`.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { kv } from './kv.js';
import {
  COIN,
  GATHER,
  GATHER_PER_MIN,
  IGLOO,
  PLAYER,
  RECIPES,
  SKINS,
  WORLD,
  getCoins,
  getNode,
  isOnIce,
  skinById,
  solidsNear,
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

const K = {
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
  /** last position we accepted an action from, with its timestamp */
  track: (wallet: string) => `pog:track:${wallet}`,
  /** last minute of play credited, so playtime cannot be spammed upward */
  playTick: (wallet: string) => `pog:playtick:${wallet}`,
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

interface Track {
  x: number;
  y: number;
  t: number;
}

/**
 * Accept an action at (x, y) only if the wallet could plausibly be there.
 * Returns an error string, or null when the move checks out.
 */
async function trackMovement(wallet: string, x: number, y: number): Promise<string | null> {
  const store = await kv();
  const now = Date.now();
  const last = await store.get<Track>(K.track(wallet));

  if (last) {
    if (now - last.t < MIN_ACTION_GAP_MS) return 'Slow down.';

    // Rejoining always puts you back on the spawn plaza, so that one jump
    // is legitimate. Everything else has to be walkable.
    const respawned = Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) <= WORLD.spawnRadius;
    if (!respawned) {
      const seconds = (now - last.t) / 1000;
      const reach = PLAYER.maxSpeed * PLAYER.iceSpeedBoost * seconds + POSITION_SLACK;
      if (Math.hypot(x - last.x, y - last.y) > reach) return 'You cannot be in two places at once.';
    }
  }

  await store.set(K.track(wallet), { x, y, t: now }, { ex: 3600 });
  return null;
}

/** How much of a resource this wallet has earned the right to hold. */
const holdCap = (profile: Profile) => HOLD_BASE + (profile.playMinutes || 0) * HOLD_PER_MINUTE;

export interface Profile {
  wallet: string;
  name: string;
  color: string;
  /** cosmetic currency — only ever spent on skins */
  pog: number;
  wood: number;
  ice: number;
  fish: number;
  /** crafted things: rod, iglooKit */
  items: Record<string, number>;
  skins: string[];
  skin: string;
  /** minutes actually played, credited at most one per real minute */
  playMinutes: number;
  createdAt: number;
  updatedAt: number;
}

export interface Igloo {
  wallet: string;
  owner: string;
  x: number;
  y: number;
  style: string;
  builtAt: number;
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
    items: p.items && typeof p.items === 'object' ? p.items : {},
    skins: Array.isArray(p.skins) ? p.skins : ['default'],
    skin: typeof p.skin === 'string' ? p.skin : 'default',
    playMinutes: Math.max(0, Math.floor(Number(p.playMinutes) || 0)),
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

/** Everything a profile is allowed to hold, capped so injection stays bounded. */
const CAPS: Record<string, number> = { pog: 1_000_000, wood: 20_000, ice: 20_000, fish: 20_000 };
const clampStock = (p: Profile) => {
  for (const k of Object.keys(CAPS)) {
    const key = k as 'pog' | 'wood' | 'ice' | 'fish';
    p[key] = Math.min(CAPS[k], Math.max(0, Math.floor(p[key])));
  }
  return p;
};

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
  await store.set(K.profile(wallet), p, { ex: PROFILE_TTL }); // sliding expiry
  return p;
}

const putProfile = async (p: Profile) => {
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

export async function saveProfile(
  wallet: string,
  name: string,
  color: string
): Promise<{ profile?: Profile; error?: string }> {
  const store = await kv();

  const owner = await nameOwner(name);
  if (owner && owner !== wallet) return { error: 'That name is already taken.' };

  const existing = await store.get<Partial<Profile>>(K.profile(wallet));
  const profile = normalize({
    ...(existing ?? {}),
    wallet,
    name,
    color: SCARF_COLORS.includes(color) ? color : SCARF_COLORS[0],
  });

  // release the previous name so it becomes available again
  if (existing?.name && existing.name.toLowerCase() !== name.toLowerCase()) {
    await store.hdel(K.names, existing.name.toLowerCase());
  }

  await store.hset(K.names, name.toLowerCase(), wallet);
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

export async function claimCoin(
  wallet: string,
  coinId: number,
  x?: unknown,
  y?: unknown
): Promise<{ pog?: number; error?: string }> {
  const coins = getCoins() as Array<{ id: number; x: number; y: number }>;
  if (!Number.isInteger(coinId) || coinId < 0 || coinId >= coins.length) {
    return { error: 'No such coin.' };
  }

  // the claimed position has to be next to the coin, and reachable from
  // wherever this wallet last acted
  const coin = coins[coinId];
  const px = Number(x);
  const py = Number(y);
  if (Number.isFinite(px) && Number.isFinite(py)) {
    if (Math.hypot(px - coin.x, py - coin.y) > COIN.pickupRadius * 2) {
      return { error: 'Too far from that coin.' };
    }
    const moveError = await trackMovement(wallet, px, py);
    if (moveError) return { error: moveError };
  }

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
  profile?: Profile;
  gained?: Record<string, number>;
  respawnAt?: number;
  error?: string;
}

export async function gather(
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
    | { yields: Record<string, number>; respawnMs: number; needs?: string }
    | undefined;
  if (!rule) return { error: 'Nothing to do here.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  if (rule.needs && !(profile.items[rule.needs] > 0)) {
    return { error: `You need a ${rule.needs} for that.` };
  }

  // you have to have been able to walk here since your last action
  const moveError = await trackMovement(wallet, px, py);
  if (moveError) return { error: moveError };

  const store = await kv();
  const perMin = GATHER_PER_MIN[node.type as keyof typeof GATHER_PER_MIN] ?? 20;
  const hits = await store.incrWithTtl(K.gatherRate(wallet, node.type), 60);
  if (hits > perMin) return { error: 'Catch your breath.' };

  const cap = holdCap(profile);
  const held = profile.wood + profile.ice + profile.fish;
  if (held >= cap) {
    return { error: 'Your pack is as full as your playtime allows. Keep playing to carry more.' };
  }

  const now = Date.now();
  await store.zremRangeByScore(K.nodes, 0, now);
  const respawnAt = now + rule.respawnMs;
  if (!(await store.zaddnx(K.nodes, respawnAt, node.id))) {
    return { error: 'Someone just worked this spot.' };
  }

  const gained: Record<string, number> = {};
  for (const [res, amount] of Object.entries(rule.yields)) {
    const key = res as 'wood' | 'ice' | 'fish';
    profile[key] += amount as number;
    gained[res] = amount as number;
  }

  return { profile: await putProfile(profile), gained, respawnAt };
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

export async function craft(wallet: string, recipeId: unknown): Promise<{ profile?: Profile; error?: string }> {
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
  for (const [item, amount] of Object.entries(recipe.gives)) {
    profile.items[item] = (profile.items[item] || 0) + (amount as number);
  }

  return { profile: await putProfile(profile) };
}

/* ------------------------------------------------------------------ *
 * Igloos — the one part of the world players author themselves
 * ------------------------------------------------------------------ */

export async function listIgloos(): Promise<Igloo[]> {
  const store = await kv();
  const all = await store.hgetall<Igloo>(K.igloos);
  return Object.values(all || {}).filter((i) => i && Number.isFinite(i.x));
}

export async function buildIgloo(
  wallet: string,
  x: unknown,
  y: unknown,
  style: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; error?: string }> {
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { error: 'Where are you?' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  if (!(profile.items.iglooKit > 0)) return { error: 'Craft an igloo kit first.' };

  if (px < 120 || py < 120 || px > WORLD.width - 120 || py > WORLD.height - 120) {
    return { error: 'Too close to the edge of the world.' };
  }
  if (isOnIce(px, py, 40)) return { error: 'You cannot build on a frozen lake.' };
  if (Math.hypot(px - WORLD.spawn.x, py - WORLD.spawn.y) < WORLD.spawnRadius + IGLOO.plazaGap) {
    return { error: 'The spawn plaza has to stay clear.' };
  }
  for (const p of solidsNear(px, py) as Array<{ x: number; y: number; r: number; scale: number }>) {
    if (Math.hypot(px - p.x, py - p.y) < p.r * p.scale + 70) return { error: 'Something is in the way.' };
  }

  const moveError = await trackMovement(wallet, px, py);
  if (moveError) return { error: moveError };

  const existing = await listIgloos();
  for (const other of existing) {
    if (other.wallet === wallet) continue;
    if (Math.hypot(px - other.x, py - other.y) < IGLOO.clearance) {
      return { error: `${other.owner} already built here.` };
    }
  }

  const igloo: Igloo = {
    wallet,
    owner: profile.name,
    x: Math.round(px),
    y: Math.round(py),
    style: IGLOO.styles.includes(style as string) ? (style as string) : IGLOO.styles[0],
    builtAt: Date.now(),
  };

  profile.items.iglooKit -= 1;
  const store = await kv();
  await store.hset(K.igloos, wallet, igloo);
  return { igloo, profile: await putProfile(profile) };
}

/* ------------------------------------------------------------------ *
 * Skin shop — the only $POG sink
 * ------------------------------------------------------------------ */

export async function buySkin(wallet: string, skinId: unknown): Promise<{ profile?: Profile; error?: string }> {
  const skin = SKINS.find((s: { id: string }) => s.id === skinId);
  if (!skin) return { error: 'No such skin.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };
  if (profile.skins.includes(skin.id)) return { error: 'You already own that.' };
  if (profile.pog < skin.price) return { error: `That costs ${skin.price} $POG.` };

  profile.pog -= skin.price;
  profile.skins.push(skin.id);
  profile.skin = skin.id;
  return { profile: await putProfile(profile) };
}

export async function equipSkin(wallet: string, skinId: unknown): Promise<{ profile?: Profile; error?: string }> {
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

export async function heartbeat(clientId: string, wallet?: string | null): Promise<number> {
  const store = await kv();
  const now = Date.now();
  await store.zadd(K.online, now, clientId.slice(0, 64));
  await store.zremRangeByScore(K.online, 0, now - ONLINE_WINDOW);

  // Credit playtime at most once per real minute, gated by a key with a
  // 55s TTL. Spamming heartbeats buys nothing; only elapsed time does.
  if (wallet) {
    const fresh = await store.setnx(K.playTick(wallet), now, 55);
    if (fresh) {
      const profile = await getProfile(wallet);
      if (profile) {
        profile.playMinutes = Math.min(100_000, (profile.playMinutes || 0) + 1);
        await putProfile(profile);
      }
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
