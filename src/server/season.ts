/**
 * The Frost ledger.
 *
 * Deliberately knows nothing about `game.ts`: it is handed a profile, it
 * mutates it, and the caller persists it. That keeps the dependency going
 * one way and means every Frost credit rides on the same profile write as
 * whatever earned it, rather than being a second write that can fail on
 * its own and leave the two ledgers disagreeing.
 *
 * There is exactly one way Frost is created — `creditFrost` — and it is
 * only ever reached from inside an action the server already validated.
 */

import { kv } from './kv.js';
import {
  FROST,
  GATE,
  OFFERINGS,
  OFFERING_DAILY_CAP,
  SEASON,
  applyMultiplier,
  dayOf,
  multipliers,
  seasonState,
  shareOf,
} from '../../shared/season.js';

/** The season columns every profile carries. */
export interface FrostFields {
  /** Frost earned this season. Never spent, never reduced. */
  frost: number;
  /** which season `frost` belongs to; a mismatch resets it */
  frostSeason: number;
  /** last UTC day Frost was banked, for the daily caps and the streak */
  frostDay: string;
  /** base Frost banked today, against FROST.dailyCap */
  frostToday: number;
  /** consecutive days with any Frost */
  frostStreak: number;
  /** base Frost taken from the cairn today, against OFFERING_DAILY_CAP */
  offerToday: number;
  /** the season the one-off igloo award was paid for, 0 if never */
  iglooFrostSeason: number;
  /** minutes played today, so a day cannot be banked in one click */
  playDay: string;
  playToday: number;
}

export const emptyFrost = (): FrostFields => ({
  frost: 0,
  frostSeason: SEASON.id,
  frostDay: '',
  frostToday: 0,
  frostStreak: 0,
  offerToday: 0,
  iglooFrostSeason: 0,
  playDay: '',
  playToday: 0,
});

/** Fill in and sanitise the season columns on a profile read from storage. */
export function normalizeFrost(p: Partial<FrostFields>): FrostFields {
  const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  return {
    frost: n(p.frost),
    frostSeason: n(p.frostSeason) || SEASON.id,
    frostDay: typeof p.frostDay === 'string' ? p.frostDay : '',
    frostToday: n(p.frostToday),
    frostStreak: n(p.frostStreak),
    offerToday: n(p.offerToday),
    iglooFrostSeason: n(p.iglooFrostSeason),
    playDay: typeof p.playDay === 'string' ? p.playDay : '',
    playToday: n(p.playToday),
  };
}

const K = {
  /** wallet -> Frost, the index behind the board and the end-of-season snapshot */
  board: `pog:frost:s${SEASON.id}`,
  /** running total of all Frost, so a share can be shown without summing the zset */
  pool: `pog:frostpool:s${SEASON.id}`,
};

const yesterdayOf = (day: string) => dayOf(Date.parse(day + 'T00:00:00Z') - 86_400_000);

/* ------------------------------------------------------------------ *
 * Rollovers
 * ------------------------------------------------------------------ */

/**
 * Bring a profile's season columns up to now: wipe them on a new season,
 * and reset the per-day counters on a new day. Idempotent.
 */
export function rollover(p: FrostFields, now = Date.now()): FrostFields {
  if (p.frostSeason !== SEASON.id) {
    const fresh = emptyFrost();
    p.frost = fresh.frost;
    p.frostSeason = SEASON.id;
    p.frostDay = '';
    p.frostToday = 0;
    p.frostStreak = 0;
    p.offerToday = 0;
    p.iglooFrostSeason = 0;
  }
  const today = dayOf(now);
  if (p.frostDay !== today) {
    p.frostToday = 0;
    p.offerToday = 0;
  }
  if (p.playDay !== today) {
    p.playDay = today;
    p.playToday = 0;
  }
  return p;
}

/** What the streak becomes if this wallet banks Frost today. */
export function pendingStreak(p: FrostFields, now = Date.now()): number {
  const today = dayOf(now);
  if (p.frostDay === today) return p.frostStreak; // already counted
  if (p.frostDay && p.frostDay === yesterdayOf(today)) return p.frostStreak + 1;
  return 1;
}

/* ------------------------------------------------------------------ *
 * Qualifying
 * ------------------------------------------------------------------ */

export interface GateInput {
  playMinutes: number;
  playToday: number;
  /** on-chain $POG; only meaningful once the mint is configured */
  balance: number;
  chainLive: boolean;
  humanRequired: boolean;
  humanVerified: boolean;
}

export interface GateItem {
  id: string;
  label: string;
  done: boolean;
  /** progress toward it, where that makes sense */
  have?: number;
  need?: number;
}

/**
 * A test seam, server-side only so it can never be reached from a browser.
 * The playtime gate is an hour by design, which no integration test can
 * sit through; `tools/seasoncheck.mjs` lowers it to run the real earning
 * path against a real server. Unset in production, where the defaults in
 * `shared/season.js` apply.
 */
function gateMinutes(): { lifetime: number; today: number } {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    lifetime: num(process.env.POG_GATE_MINUTES, GATE.minutes),
    today: num(process.env.POG_GATE_MINUTES_TODAY, GATE.minutesToday),
  };
}

/**
 * The checklist, returned in full rather than as a boolean so the UI can
 * say exactly what is missing instead of "not eligible".
 */
export function eligibility(g: GateInput): { ok: boolean; items: GateItem[] } {
  const min = gateMinutes();
  const items: GateItem[] = [
    {
      id: 'minutes',
      label: `Play ${min.lifetime} minutes`,
      done: g.playMinutes >= min.lifetime,
      have: Math.min(g.playMinutes, min.lifetime),
      need: min.lifetime,
    },
    {
      id: 'today',
      label: `Play ${min.today} minutes today`,
      done: g.playToday >= min.today,
      have: Math.min(g.playToday, min.today),
      need: min.today,
    },
  ];

  // Both of these are conditions of the deploy, not of the player. When
  // they are off they are left out of the list rather than shown as met.
  if (g.humanRequired) {
    items.push({ id: 'human', label: 'Pass the captcha once', done: g.humanVerified });
  }
  // `hold: 0` is the middle-ground config: the mint is live, so holding
  // still multiplies what you earn, but it is not required to qualify.
  // Listing "Hold 0 $POG" as a checklist item would be noise.
  if (g.chainLive && GATE.hold > 0) {
    items.push({
      id: 'hold',
      label: `Hold ${GATE.holdLabel}`,
      done: g.balance >= GATE.hold,
      have: g.balance,
      need: GATE.hold,
    });
  }

  return { ok: items.every((i) => i.done), items };
}

/* ------------------------------------------------------------------ *
 * Banking Frost
 * ------------------------------------------------------------------ */

export interface Credit {
  /** base Frost actually used, after the daily cap clipped it */
  base: number;
  /** what landed in the ledger, after multipliers */
  banked: number;
  /** base Frost still available today */
  roomLeft: number;
}

/**
 * The single write path. `base` is pre-multiplier; the caller works out
 * `multTotal` from the profile's own streak, igloo and on-chain holding.
 *
 * Callers must have checked `eligibility` first — this function does not,
 * because the things it needs (on-chain balance, captcha) are async and
 * belong at the request boundary, not in the middle of a profile mutation.
 */
export function creditFrost(
  p: FrostFields,
  base: number,
  multTotal: number,
  now = Date.now()
): Credit {
  rollover(p, now);

  const want = Math.max(0, Math.floor(base));
  const room = Math.max(0, FROST.dailyCap - p.frostToday);
  const use = Math.min(want, room);
  if (use <= 0) return { base: 0, banked: 0, roomLeft: room };

  const banked = applyMultiplier(use, multTotal);
  p.frostToday += use;
  p.frost += banked;

  // The streak only advances on a day that actually produced Frost, so a
  // session that hits the cap with nothing left over cannot extend it.
  const today = dayOf(now);
  if (p.frostDay !== today) {
    p.frostStreak = pendingStreak(p, now);
    p.frostDay = today;
  }

  return { base: use, banked, roomLeft: room - use };
}

/** Mirror a profile's Frost into the season index. Call after persisting. */
export async function indexFrost(wallet: string, total: number, delta: number): Promise<void> {
  const store = await kv();
  await store.zadd(K.board, total, wallet);
  if (delta > 0) await store.incrBy(K.pool, delta);
}

/* ------------------------------------------------------------------ *
 * Offerings at the cairn
 * ------------------------------------------------------------------ */

export type Stock = { wood: number; ice: number; fish: number; gold: number };

/**
 * Burn resources for Frost. Bounded twice — by its own daily cap and by
 * the shared one — and priced in materials that could only have been
 * gathered under the existing per-minute limits. There is no way to push
 * harder on this than the world allows anyone to gather.
 */
type Offering = (typeof OFFERINGS)[keyof typeof OFFERINGS];

/**
 * Everything that can refuse an offering, with nothing mutated.
 *
 * Split out so the caller can run it BEFORE the movement check. A request
 * with a bad id or one the player cannot afford should not consume the
 * action budget — otherwise a typo costs you a second of play, and, worse,
 * the rate limiter starts answering for checks that never ran.
 */
export function checkOffering(
  p: FrostFields & Stock,
  offeringId: unknown,
  now = Date.now()
): { offering?: Offering; error?: string } {
  // Object.hasOwn, not a bare lookup: OFFERINGS['__proto__'] is truthy.
  const offering =
    typeof offeringId === 'string' && Object.hasOwn(OFFERINGS, offeringId)
      ? OFFERINGS[offeringId as keyof typeof OFFERINGS]
      : null;
  if (!offering) return { error: 'No such offering.' };

  rollover(p, now);

  if (p.offerToday >= OFFERING_DAILY_CAP) {
    return { error: 'The cairn has taken all it will today. Come back tomorrow.' };
  }
  for (const [res, need] of Object.entries(offering.cost)) {
    if (p[res as keyof Stock] < need) return { error: `Not enough ${res}.` };
  }
  if (Math.max(0, FROST.dailyCap - p.frostToday) <= 0) {
    return { error: 'You have banked all the Frost you can today.' };
  }
  return { offering };
}

export function applyOffering(
  p: FrostFields & Stock,
  offeringId: unknown,
  multTotal: number,
  now = Date.now()
): { credit?: Credit; spent?: Record<string, number>; error?: string } {
  const { offering, error } = checkOffering(p, offeringId, now);
  if (!offering) return { error };

  // Clip to whichever cap bites first, and refuse rather than half-charge.
  const allowed = Math.min(offering.frost, OFFERING_DAILY_CAP - p.offerToday);
  const room = Math.max(0, FROST.dailyCap - p.frostToday);
  if (Math.min(allowed, room) <= 0) {
    return { error: 'You have banked all the Frost you can today.' };
  }

  const spent: Record<string, number> = {};
  for (const [res, need] of Object.entries(offering.cost)) {
    p[res as keyof Stock] -= need;
    spent[res] = need;
  }

  const credit = creditFrost(p, Math.min(allowed, room), multTotal, now);
  p.offerToday += credit.base;
  return { credit, spent };
}

/* ------------------------------------------------------------------ *
 * Reading the season back
 * ------------------------------------------------------------------ */

export interface BoardRow {
  rank: number;
  wallet: string;
  frost: number;
}

export async function frostPool(): Promise<number> {
  const store = await kv();
  return Math.max(0, Number(await store.get<number>(K.pool)) || 0);
}

export async function frostBoard(limit = 25): Promise<BoardRow[]> {
  const store = await kv();
  const top = await store.ztop(K.board, Math.min(200, Math.max(1, limit)));
  return top.map((t, i) => ({ rank: i + 1, wallet: t.member, frost: Math.round(t.score) }));
}

/** Rank within the top 200; null past that rather than a misleading number. */
export async function frostRank(wallet: string): Promise<number | null> {
  const store = await kv();
  const top = await store.ztop(K.board, 200);
  const i = top.findIndex((t) => t.member === wallet);
  return i < 0 ? null : i + 1;
}

/** Everything the season panel renders, assembled in one place. */
export async function seasonSummary(
  wallet: string,
  p: FrostFields,
  gate: GateInput,
  hasIgloo: boolean
) {
  const state = seasonState();
  const [pool, rank] = await Promise.all([frostPool(), frostRank(wallet)]);

  const mult = multipliers({
    streakDays: pendingStreak(p),
    hasIgloo,
    balance: gate.balance,
  });

  return {
    season: state,
    budget: SEASON.budget,
    budgetLabel: SEASON.budgetLabel,
    frost: p.frost,
    frostToday: p.frostToday,
    dailyCap: FROST.dailyCap,
    offerToday: p.offerToday,
    offerCap: OFFERING_DAILY_CAP,
    streak: p.frostStreak,
    multipliers: mult,
    pool,
    rank,
    ...shareOf(p.frost, pool),
    gate: eligibility(gate),
  };
}

export { K as SEASON_KEYS };
