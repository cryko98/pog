/**
 * The casino, server side: provably fair rolls, P coins only.
 *
 * ------------------------------------------------------------------ *
 * Why it cannot be rigged — by us or by the player
 * ------------------------------------------------------------------ *
 *
 * Every UTC day the server draws a secret seed and publishes only its
 * SHA-256. Each bet's roll is HMAC-SHA256(seed, wallet:day:nonce:client)
 * where `nonce` counts the wallet's bets that day and `client` is a
 * string the player chose. The server cannot pick a roll after seeing the
 * bet without changing the seed it committed to; the player cannot know
 * a roll in advance without the seed, and the client seed makes sure the
 * server cannot precompute a losing table either. Yesterday's seed is
 * public, so any bet can be checked afterwards.
 *
 * The wager is taken and the win paid under the wallet lock, in one
 * step, so a bet cannot be replayed, doubled or abandoned halfway. The
 * house edge is burned — nobody's balance goes up by what players lose.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { kv } from './kv.js';
import { withWallet } from './lock.js';
import { GATHER, getNode } from '../../shared/world.js';
import { CASINO, GAMES, multiplierOf, normaliseChoice, outcomeOf } from '../../shared/casino.js';
import { K, getProfile, putProfile, trackMovement, type Profile } from './game.js';

export interface Bet {
  game: keyof typeof GAMES;
  choice: string;
  wager: number;
  multiplier: number;
  shown: string;
  won: boolean;
  paid: number;
  /** the hex the roll came from — public, since the seed cannot be recovered from it */
  digest: string;
  /** the race, when the hand was one: every bear's pace per leg and finish time */
  race?: { paces: number[][]; times: number[]; winner: string };
  nonce: number;
  day: string;
  clientSeed: string;
  at: number;
}

const KEY = {
  seed: (day: string) => `pog:casino:seed:${day}`,
  nonce: (wallet: string, day: string) => `pog:casino:n:${wallet}:${day}`,
  rate: (wallet: string) => `pog:casino:rate:${wallet}`,
  log: (wallet: string) => `pog:casino:log:${wallet}`,
  wagered: (day: string) => `pog:casino:wagered:${day}`,
  paid: (day: string) => `pog:casino:paid:${day}`,
};

const SEED_TTL = 40 * 24 * 3600;
export const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Today's secret, drawn once and kept; only its hash leaves the server. */
async function seedFor(day: string): Promise<string> {
  const store = await kv();
  const fresh = randomBytes(32).toString('hex');
  await store.setnx(KEY.seed(day), fresh, SEED_TTL);
  return (await store.get<string>(KEY.seed(day))) || fresh;
}

/** The roll for a bet, in [0, 1). */
export function rollOf(seed: string, wallet: string, day: string, nonce: number, clientSeed: string): { roll: number; digest: string } {
  const digest = createHmac('sha256', seed).update(`${wallet}:${day}:${nonce}:${clientSeed}`).digest('hex');
  return { roll: parseInt(digest.slice(0, 13), 16) / 2 ** 52, digest };
}

async function atCasino(wallet: string, x: unknown, y: unknown): Promise<string | null> {
  const casino = getNode('station-casino');
  const px = Number(x);
  const py = Number(y);
  if (!casino) return 'The casino is not there.';
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 'Where are you?';
  if (Math.hypot(px - casino.x, py - casino.y) > GATHER.range * 2.2) return 'Walk over to the casino first.';
  return trackMovement(wallet, px, py);
}

/* ------------------------------------------------------------------ *
 * What the player sees
 * ------------------------------------------------------------------ */

export async function casinoState(wallet: string) {
  const store = await kv();
  const day = dayOf();
  const yesterday = dayOf(Date.now() - 86_400_000);
  const [seed, log, nonce, revealed, wagered, paid] = await Promise.all([
    seedFor(day),
    store.lrange<Bet>(KEY.log(wallet), -20, -1),
    store.get<number>(KEY.nonce(wallet, day)),
    store.get<string>(KEY.seed(yesterday)),
    store.get<number>(KEY.wagered(day)),
    store.get<number>(KEY.paid(day)),
  ]);
  return {
    day,
    /** the commitment: SHA-256 of today's secret seed */
    commit: sha256(seed),
    /** yesterday's seed in the clear, so yesterday's bets can be checked */
    reveal: revealed ? { day: yesterday, seed: revealed } : null,
    nonce: Number(nonce) || 0,
    rules: CASINO,
    games: Object.values(GAMES),
    recent: log.slice().reverse(),
    today: { wagered: Number(wagered) || 0, paid: Number(paid) || 0 },
  };
}

/** A past day's seed, once that day is over. */
export async function revealSeed(day: unknown): Promise<{ day: string; seed: string | null; commit: string | null }> {
  const d = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
  if (!d || d >= dayOf()) return { day: d, seed: null, commit: null };
  const seed = await (await kv()).get<string>(KEY.seed(d));
  return { day: d, seed, commit: seed ? sha256(seed) : null };
}

/* ------------------------------------------------------------------ *
 * A bet
 * ------------------------------------------------------------------ */

export async function placeBet(
  wallet: string,
  game: unknown,
  choice: unknown,
  wager: unknown,
  clientSeed: unknown,
  x: unknown,
  y: unknown
): Promise<{ bet?: Bet; profile?: Profile; error?: string }> {
  if (typeof game !== 'string' || !Object.hasOwn(GAMES, game)) return { error: 'No such game.' };
  const pick = normaliseChoice(game, choice);
  if (pick === null) return { error: 'That is not a choice this table takes.' };
  const amount = Math.floor(Number(wager));
  if (!Number.isFinite(amount) || amount < CASINO.minWager || amount > CASINO.maxWager) {
    return { error: `Wager between ${CASINO.minWager} and ${CASINO.maxWager.toLocaleString('en-US')} P coins.` };
  }
  const client = typeof clientSeed === 'string' ? clientSeed.replace(/[^\w.-]/g, '').slice(0, 32) : '';
  const where = await atCasino(wallet, x, y);
  if (where) return { error: where };

  return withWallet(wallet, async () => {
    const store = await kv();
    if ((await store.incrWithTtl(KEY.rate(wallet), 60)) > CASINO.betsPerMin) return { error: 'Slow down — the table deals one hand at a time.' };
    const profile = await getProfile(wallet);
    if (!profile) return { error: 'Pick a username first.' };
    if (profile.pog < amount) return { error: `You have ${profile.pog.toLocaleString('en-US')} P coins.` };

    const day = dayOf();
    const seed = await seedFor(day);
    const nonce = await store.incrBy(KEY.nonce(wallet, day), 1);
    const { roll, digest } = rollOf(seed, wallet, day, nonce, client);
    const multiplier = multiplierOf(game, pick);
    const { shown, won, race } = outcomeOf(game, pick, roll, digest);
    const paid = won ? Math.floor(amount * multiplier) : 0;

    profile.pog += paid - amount;
    const saved = await putProfile(profile);
    await store.zadd(K.leaderboard, saved.pog, wallet);

    const bet: Bet = { game: game as keyof typeof GAMES, choice: pick, wager: amount, multiplier, shown, won, paid, digest, nonce, day, clientSeed: client, at: Date.now() };
    if (race) bet.race = race;
    await store.rpushCapped(KEY.log(wallet), bet, 40);
    await store.incrBy(KEY.wagered(day), amount);
    if (paid) await store.incrBy(KEY.paid(day), paid);
    return { bet, profile: saved };
  });
}
