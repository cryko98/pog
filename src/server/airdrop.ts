/**
 * The daily airdrop: closing each UTC day into per-wallet amounts owed,
 * and paying what is owed from the airdrop wallet.
 *
 * ------------------------------------------------------------------ *
 * How a day closes
 * ------------------------------------------------------------------ *
 *
 * While a day runs, every Frost credit also lands in that day's index —
 * `pog:fday:<day>`, wallet -> Frost banked that day — from inside the
 * same validated action that banked it. When the day is over, the first
 * request to notice (or the cron) closes it, once, under a global lock:
 * the day's budget is a fraction of what the wallet holds, the split is
 * `splitDay` in `shared/airdrop.js`, and each wallet's amount is added to
 * what it is owed. A closed day is recorded so it can never be closed
 * twice, and the record says exactly what was paid to whom, so the maths
 * can be checked afterwards.
 *
 * ------------------------------------------------------------------ *
 * How it is paid
 * ------------------------------------------------------------------ *
 *
 * Lazily, per wallet: the next time a wallet reads its season status (or
 * asks), whatever it is owed — whole tokens, at least `minPayout` — is
 * sent from the airdrop wallet under that wallet's lock, and the signature
 * is kept. That spreads the sending over the day instead of needing one
 * long job, and a wallet that never comes back is never paid, which is
 * fine: the tokens stay in the wallet and go into the next days' budgets.
 * Without the key in the environment, the owed balances simply wait, and
 * go out on each wallet's next visit once the key is set.
 *
 * Nothing here takes an amount or a recipient from a request.
 */

import { kv } from './kv.js';
import { withWallet } from './lock.js';
import { AIRDROP, dailyBudget, splitDay } from '../../shared/airdrop.js';
import { dayOf } from '../../shared/season.js';
import { iglooLevel } from '../../shared/world.js';
import { chainLive, heldBalance } from './chain.js';
import { airdropAddress, airdropReady, canPayAirdrop, payFromAirdrop } from './pool.js';
import { K, type Igloo } from './game.js';
import { SEASON_KEYS } from './season.js';

const KEY = {
  /** the day's record, once closed */
  day: (day: string) => `pog:airdrop:day:${day}`,
  /** the closing lock, so two requests at midnight do not both close it */
  closing: (day: string) => `pog:airdrop:closing:${day}`,
  /** whole tokens owed to a wallet, not yet sent */
  owed: (wallet: string) => `pog:airdrop:owed:${wallet}`,
  /** every wallet with something owed, for the operator's tool */
  owedSet: 'pog:airdrop:owedset',
  /** a wallet's payouts, newest last */
  history: (wallet: string) => `pog:airdrop:hist:${wallet}`,
  /** a wallet's share of each closed day, so the panel can say "yesterday: N" */
  dayShare: (wallet: string, day: string) => `pog:airdrop:share:${wallet}:${day}`,
  /** what the wallet is taken to hold before the chain exists; decremented as days close */
  virtual: 'pog:airdrop:virtual',
  /** running totals */
  paidTotal: 'pog:airdrop:paidtotal',
  closedList: 'pog:airdrop:closed',
};

const DAY_TTL = 400 * 24 * 3600;
const yesterday = () => dayOf(Date.now() - 86_400_000);

export interface DayRecord {
  day: string;
  remaining: number;
  budget: number;
  frostPool: number;
  wallets: number;
  paid: number;
  closedAt: number;
  /** on chain, or the pre-launch ledger */
  source: 'chain' | 'virtual';
}

export interface Payout {
  day?: string;
  amount: number;
  signature: string;
  at: number;
}

/** What the airdrop wallet holds: on chain once live, the virtual ledger before. */
export async function remainingSupply(): Promise<{ remaining: number; source: 'chain' | 'virtual' }> {
  const store = await kv();
  if (airdropReady()) {
    const held = await heldBalance(airdropAddress());
    if (held > 0) return { remaining: Math.floor(held), source: 'chain' };
  }
  const v = await store.get<number>(KEY.virtual);
  return { remaining: v == null ? AIRDROP.supply : Math.max(0, Math.floor(Number(v) || 0)), source: 'virtual' };
}

/* ------------------------------------------------------------------ *
 * Closing a day
 * ------------------------------------------------------------------ */

/**
 * Close `day` if it is over and not closed yet. Returns the record either
 * way, or null when the day is still running. Safe to call constantly.
 */
export async function closeDay(day: string, force = false): Promise<DayRecord | null> {
  if (day >= dayOf() && !force) return null; // still running
  const store = await kv();
  if (force) {
    // dev only: close the day again from scratch, so a test can run twice
    await store.del(KEY.day(day));
    await store.del(KEY.closing(day));
  }
  const done = await store.get<DayRecord>(KEY.day(day));
  if (done) return done;
  // one closer at a time; a crashed one lets the next try after a minute
  if (!(await store.setnx(KEY.closing(day), Date.now(), 60))) return null;

  const again = await store.get<DayRecord>(KEY.day(day));
  if (again) return again;

  const { remaining, source } = await remainingSupply();
  const budget = dailyBudget(remaining);
  const members = await store.zrangeByScore(`pog:fday:${day}`, 1, Number.MAX_SAFE_INTEGER);
  const rows: Array<{ wallet: string; frost: number; iglooValue: number }> = [];
  if (members.length && budget > 0) {
    const igloos = (await store.hgetall<Igloo>(K.igloos)) || {};
    const scores = await store.ztop(`pog:fday:${day}`, 10_000);
    const byWallet = new Map(scores.map((s) => [s.member, s.score]));
    for (const wallet of members) {
      const frost = Math.floor(byWallet.get(wallet) ?? 0);
      if (frost <= 0) continue;
      const igloo = igloos[wallet];
      const iglooValue = igloo ? iglooLevel(igloo.furniture ?? []).value : 0;
      rows.push({ wallet, frost, iglooValue });
    }
  }
  const split: Array<{ wallet: string; frost: number; players: number; igloo: number; total: number }> = splitDay(budget, rows);
  let paid = 0;
  for (const s of split) {
    if (s.total <= 0) continue;
    paid += s.total;
    const owed = await store.incrBy(KEY.owed(s.wallet), s.total);
    await store.zadd(KEY.owedSet, owed, s.wallet);
    await store.set(KEY.dayShare(s.wallet, day), { players: s.players, igloo: s.igloo, total: s.total, frost: s.frost }, { ex: DAY_TTL });
  }
  if (source === 'virtual') await store.set(KEY.virtual, Math.max(0, remaining - paid));

  const record: DayRecord = {
    day,
    remaining,
    budget,
    frostPool: rows.reduce((a, r) => a + r.frost, 0),
    wallets: split.filter((s) => s.total > 0).length,
    paid,
    closedAt: Date.now(),
    source,
  };
  await store.set(KEY.day(day), record, { ex: DAY_TTL });
  await store.rpushCapped(KEY.closedList, record, 400);
  return record;
}

/** Close yesterday if nobody has yet. Cheap once it is done. */
let lastEnsured = '';
export async function ensureClosed(): Promise<void> {
  const y = yesterday();
  if (lastEnsured === y) return;
  const rec = await closeDay(y);
  if (rec) lastEnsured = y;
}

export async function dayRecord(day: string): Promise<DayRecord | null> {
  return (await kv()).get<DayRecord>(KEY.day(day));
}

export async function recentDays(limit = 14): Promise<DayRecord[]> {
  const rows = await (await kv()).lrange<DayRecord>(KEY.closedList, -limit, -1);
  return rows.slice().reverse();
}

/* ------------------------------------------------------------------ *
 * Paying a wallet
 * ------------------------------------------------------------------ */

export async function owedTo(wallet: string): Promise<number> {
  return Math.max(0, Math.floor(Number(await (await kv()).get<number>(KEY.owed(wallet))) || 0));
}

/**
 * Send a wallet what it is owed, if there is a key to send with. Runs
 * under the wallet's lock so two reads cannot both pay. Returns what was
 * sent and the signature, or nothing when there was nothing to do.
 */
export async function settleOwed(wallet: string): Promise<{ paid: number; signature?: string; pending: number }> {
  // a cheap look first: most reads owe nothing, and need no lock
  const peek = await owedTo(wallet);
  if (peek < AIRDROP.minPayout || !canPayAirdrop()) return { paid: 0, pending: peek };
  return withWallet(wallet, async () => {
    const store = await kv();
    const owed = await owedTo(wallet);
    if (owed < AIRDROP.minPayout || !canPayAirdrop()) return { paid: 0, pending: owed };
    // take it off the ledger BEFORE sending; a failed send puts it back.
    // The other order can pay twice; this order can at worst pay late.
    await store.set(KEY.owed(wallet), 0);
    const signature = await payFromAirdrop(wallet, owed);
    if (!signature) {
      await store.incrBy(KEY.owed(wallet), owed);
      return { paid: 0, pending: owed };
    }
    await store.zadd(KEY.owedSet, 0, wallet);
    const entry: Payout = { amount: owed, signature, at: Date.now() };
    await store.rpushCapped(KEY.history(wallet), entry, 60);
    await store.incrBy(KEY.paidTotal, owed);
    return { paid: owed, signature, pending: 0 };
  });
}

/* ------------------------------------------------------------------ *
 * What a wallet sees
 * ------------------------------------------------------------------ */

export async function airdropFor(wallet: string, frostToday: number) {
  const store = await kv();
  const today = dayOf();
  const y = yesterday();
  const [owed, history, yShare, yRecord, supply, todayPool] = await Promise.all([
    owedTo(wallet),
    store.lrange<Payout>(KEY.history(wallet), -10, -1),
    store.get<{ players: number; igloo: number; total: number; frost: number }>(KEY.dayShare(wallet, y)),
    dayRecord(y),
    remainingSupply(),
    store.get<number>(`pog:fdaypool:${today}`),
  ]);
  const pool = Math.max(0, Number(todayPool) || 0);
  const budget = dailyBudget(supply.remaining);
  // a running estimate of today's share: the players' slice by Frost so far
  const estimate = pool > 0 && frostToday > 0 ? Math.floor((budget * AIRDROP.playersShare * frostToday) / pool) : 0;
  return {
    wallet: airdropAddress() || null,
    live: airdropReady(),
    automatic: canPayAirdrop(),
    remaining: supply.remaining,
    source: supply.source,
    todayBudget: budget,
    todayPool: pool,
    todayEstimate: estimate,
    owed,
    yesterday: yShare ? { day: y, ...yShare } : null,
    yesterdayRecord: yRecord,
    history: history.slice().reverse(),
    rules: AIRDROP,
  };
}

export type AirdropView = Awaited<ReturnType<typeof airdropFor>>;

/** Which chain the keys are on, for the config endpoint. */
export const airdropConfig = () => ({
  wallet: airdropAddress() || null,
  live: airdropReady() && chainLive(),
  automatic: canPayAirdrop(),
  rules: AIRDROP,
});

export { SEASON_KEYS };
