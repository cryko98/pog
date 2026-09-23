/**
 * The airdrop wallet, and how it pays out — every day, by share.
 *
 * ------------------------------------------------------------------ *
 * The shape of it
 * ------------------------------------------------------------------ *
 *
 * One wallet holds the whole play-to-earn allocation. Every UTC day it
 * pays out a fixed FRACTION of whatever it still holds — not a fixed
 * number of tokens — so the daily budget is biggest at launch, shrinks
 * as the wallet does, and never quite runs out: at 0.2% a day, half of
 * what is left is paid in the first year, half of the rest in the next.
 * Many players do not drain it faster; they split the same day's budget
 * into more, smaller shares. The budget has a floor, so the tail is not
 * absurdly thin, and a ceiling, so a topped-up wallet does not pay a
 * fortune in one day.
 *
 * The day's budget is split two ways:
 *
 *   players  — by the Frost each wallet banked THAT DAY (already capped
 *              and multiplied, so it is a measure of performance rather
 *              than of hours), among wallets that banked any;
 *   igloos   — by igloo value, among those same wallets' igloos. A
 *              furnished igloo earns its owner a slice every day they are
 *              active. An igloo nobody plays from earns nothing.
 *
 * Payouts below a whole token carry over to the next day rather than
 * being lost. Nothing here is a promise of a rate: a share always adds
 * up to exactly the day's budget, however many people played.
 */

export const AIRDROP = {
  /** what the wallet is funded with; informational once the chain is live */
  supply: 50_000_000,
  supplyLabel: '50,000,000 $POG',
  /** share of what the wallet holds, paid out each day */
  dailyRate: 0.002,
  /** the day's budget never goes below this while there is that much left, nor above the cap */
  dailyFloor: 5_000,
  dailyCap: 250_000,
  /** how the day's budget splits */
  playersShare: 0.8,
  iglooShare: 0.2,
  /** whole tokens only; less than this carries to the next day */
  minPayout: 1,
};

/** What one day pays, given what the wallet holds at the start of it. */
export function dailyBudget(remaining) {
  const left = Math.max(0, Math.floor(Number(remaining) || 0));
  if (left <= 0) return 0;
  const raw = Math.floor(left * AIRDROP.dailyRate);
  return Math.min(left, Math.max(Math.min(AIRDROP.dailyFloor, left), Math.min(AIRDROP.dailyCap, raw)));
}

/**
 * Split a day's budget among the wallets that banked Frost that day.
 * `rows` is `[{ wallet, frost, iglooValue }]` — `iglooValue` is the
 * furnished value of the wallet's igloo, or 0 without one. Returns
 * `[{ wallet, frost, players, igloo, total }]` in whole tokens, with the
 * budget's rounding remainder left unpaid (it stays in the wallet).
 */
export function splitDay(budget, rows) {
  const total = Math.max(0, Math.floor(Number(budget) || 0));
  const active = rows.filter((r) => r && r.frost > 0);
  const frostSum = active.reduce((a, r) => a + r.frost, 0);
  const iglooSum = active.reduce((a, r) => a + Math.max(0, r.iglooValue || 0), 0);
  const forPlayers = Math.floor(total * AIRDROP.playersShare);
  // with no furnished igloo in play, the igloo slice goes to the players too
  const forIgloos = iglooSum > 0 ? total - forPlayers : 0;
  const playersPot = iglooSum > 0 ? forPlayers : total;
  return active.map((r) => {
    const players = frostSum > 0 ? Math.floor((playersPot * r.frost) / frostSum) : 0;
    const igloo = iglooSum > 0 ? Math.floor((forIgloos * Math.max(0, r.iglooValue || 0)) / iglooSum) : 0;
    return { wallet: r.wallet, frost: r.frost, players, igloo, total: players + igloo };
  });
}

/**
 * How the wallet drains over time at the daily rate, for the docs and the
 * panel: what is left after `days`, ignoring the floor and the cap.
 */
export function remainingAfter(days, start = AIRDROP.supply) {
  return Math.floor(start * Math.pow(1 - AIRDROP.dailyRate, Math.max(0, days)));
}
