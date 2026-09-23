/**
 * Seasons and Frost — the airdrop ledger.
 *
 * $POG is the soft currency: you find it, you spend it on hats, it goes up
 * and down. Frost is something else entirely. It is the record of what you
 * actually did this season, it is never spendable, and it never goes down.
 * At the end of a season a fixed budget of tokens is split by share:
 *
 *     your tokens = your Frost / all Frost * SEASON_BUDGET
 *
 * That "by share" is the whole point. Promising a rate — "1 Frost = N
 * tokens" — cannot be honoured, because the game mints Frost forever and
 * the token supply is fixed. A share always adds up to exactly 100%.
 *
 * ------------------------------------------------------------------ *
 * Why this is hard to farm
 * ------------------------------------------------------------------ *
 *
 * You cannot beat sybils with game design alone. Ten wallets playing an
 * hour each will always be able to do what one wallet does in ten hours.
 * What you *can* do is make every extra wallet cost something, and make
 * depth pay better than breadth. Both are in here:
 *
 *  1. A wallet earns ZERO Frost until it qualifies. Qualifying costs an
 *     hour of server-counted playtime, a captcha, and — once the token is
 *     live — a minimum on-chain balance. That is a real per-wallet price.
 *  2. Above the gate, the daily base is capped, so no wallet can out-grind
 *     the cap. The cap is deliberately reachable by a normal session.
 *  3. Multipliers stack MULTIPLICATIVELY on that capped base, and every
 *     one of them rewards concentration: a streak has to be kept alive
 *     daily, an igloo costs a session's work, and the holder tiers are
 *     absolute so splitting a bag across ten wallets drops all ten into a
 *     lower tier. One deep wallet beats three shallow ones.
 *  4. Frost is only ever written by the server, from inside actions that
 *     already carry position checks and rate caps. There is no endpoint
 *     that accepts "credit me".
 */

/** Bump `id` to start a new season. Everything resets against the new id. */
export const SEASON = {
  // id 2: the ledger was wiped for launch day, so every wallet starts at zero
  id: 2,
  name: 'First Frost',
  /** UTC day the season opens and closes (closes at 00:00 UTC on `ends`) */
  starts: '2026-09-23',
  ends: '2026-10-21',
  /**
   * Tokens set aside for this season, split by Frost share. Informational
   * on the client; the actual transfer is done from the snapshot.
   */
  budget: 10_000_000,
  budgetLabel: '10,000,000 $POG',
};

/* ------------------------------------------------------------------ *
 * The gate — what a wallet must do before Frost accrues at all
 * ------------------------------------------------------------------ */

export const GATE = {
  /** lifetime minutes, counted one per real minute by the heartbeat */
  minutes: 60,
  /** and this many minutes today, so a day cannot be banked in one click */
  minutesToday: 10,
  /**
   * Minimum on-chain $POG to qualify. Enforced only once POG_MINT is set
   * in the environment — before the token exists there is nothing to hold,
   * and the requirement is simply not part of the checklist.
   */
  hold: 25_000,
  holdLabel: '25,000 $POG',
};

/**
 * Chat is for holders. Any wallet holding at least this much $POG on
 * chain may talk; everyone else can read. Before the token is live,
 * nobody can — there is no holder to be.
 */
export const CHAT = {
  hold: 1,
  holdLabel: '1 $POG',
  /** the team's wallets: may always talk, holding or not, token live or not */
  always: ['2QM2EWyLhwiFSmQv1whR3twumY6J63DCBrsgWUYbKizF'],
};

/** Everyone may read the chat; this says who may write. */
export const mayChat = (wallet, balance, live) => CHAT.always.includes(wallet) || (live && balance >= CHAT.hold);

/* ------------------------------------------------------------------ *
 * Earning Frost
 *
 * Deliberately coarse. Frost does not come from swinging an axe — that is
 * what $POG and resources are for. It comes from finishing things, which
 * is far harder to script convincingly and much cheaper to verify.
 * ------------------------------------------------------------------ */

export const FROST = {
  /** clearing one daily quest */
  quest: 10,
  /** clearing all three on the same day */
  questSweep: 15,
  /** per block of minutes played, and the most blocks that count in a day */
  perPlayBlock: 1,
  playBlockMinutes: 5,
  maxPlayBlocks: 24,
  /** raising an igloo, once per season */
  igloo: 50,
  /** the most base Frost one day can produce, before multipliers */
  dailyCap: 100,
};

/**
 * Offerings at the cairn: resources burned out of the economy for Frost.
 *
 * This is the only Frost source you can push on directly, which is why it
 * has its own daily cap — and why it costs materials that had to be
 * gathered under the existing per-minute limits. Farming Frost here is
 * bounded by how fast the world lets anyone gather at all.
 */
export const OFFERINGS = {
  wood: { id: 'wood', label: 'A cord of wood', cost: { wood: 50 }, frost: 6 },
  ice: { id: 'ice', label: 'A pallet of ice', cost: { ice: 50 }, frost: 6 },
  fish: { id: 'fish', label: 'A haul of fish', cost: { fish: 10 }, frost: 6 },
};

/** The most Frost a wallet can take from the cairn in one day. */
export const OFFERING_DAILY_CAP = 30;

/* ------------------------------------------------------------------ *
 * Multipliers
 *
 * Applied to the day's base Frost, multiplied together and rounded once.
 * Every one of them is cheaper to earn on one account than on five.
 * ------------------------------------------------------------------ */

/** Consecutive days with any Frost at all. */
export const STREAK = { perDay: 0.05, capDays: 14 };

/** Owning an igloo — 300 wood and 120 ice, per wallet. */
export const IGLOO_BONUS = 0.15;

/**
 * On-chain $POG held, checked at the moment Frost is banked.
 *
 * Absolute thresholds, on purpose: a bag split across ten wallets puts
 * every one of them in a lower tier than the same bag held in one. This
 * is the single strongest anti-sybil lever available, because it is the
 * only one that costs money rather than time.
 */
export const HOLDER_TIERS = [
  { min: 1_000_000, mult: 0.5, label: 'Glacier' },
  { min: 250_000, mult: 0.3, label: 'Drift' },
  { min: 50_000, mult: 0.15, label: 'Flurry' },
  { min: 0, mult: 0, label: '—' },
];

export function holderTier(balance) {
  const held = Number(balance) || 0;
  return HOLDER_TIERS.find((t) => held >= t.min) ?? HOLDER_TIERS[HOLDER_TIERS.length - 1];
}

/**
 * The day's multiplier, broken out so the UI can show exactly where each
 * part came from rather than one unexplained number.
 */
export function multipliers({ streakDays = 0, hasIgloo = false, balance = 0 }) {
  const streak = Math.min(streakDays, STREAK.capDays) * STREAK.perDay;
  const igloo = hasIgloo ? IGLOO_BONUS : 0;
  const tier = holderTier(balance);
  return {
    streak: { add: streak, days: Math.min(streakDays, STREAK.capDays) },
    igloo: { add: igloo, has: hasIgloo },
    holder: { add: tier.mult, label: tier.label, balance: Number(balance) || 0 },
    total: (1 + streak) * (1 + igloo) * (1 + tier.mult),
  };
}

/** Frost actually banked for a base amount, under a given multiplier. */
export const applyMultiplier = (base, total) => Math.floor(base * total);

/* ------------------------------------------------------------------ *
 * Season timing
 * ------------------------------------------------------------------ */

export const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const asMs = (day) => Date.parse(day + 'T00:00:00Z');

export function seasonState(now = Date.now()) {
  const start = asMs(SEASON.starts);
  const end = asMs(SEASON.ends);
  return {
    id: SEASON.id,
    name: SEASON.name,
    open: now >= start && now < end,
    before: now < start,
    over: now >= end,
    startsAt: start,
    endsAt: end,
    daysLeft: Math.max(0, Math.ceil((end - now) / 86_400_000)),
    dayNumber: Math.max(1, Math.floor((now - start) / 86_400_000) + 1),
    totalDays: Math.round((end - start) / 86_400_000),
  };
}

/**
 * What one wallet's Frost is worth, given the whole pool. Pure display —
 * the real number comes out of the end-of-season snapshot.
 */
export function shareOf(frost, poolFrost) {
  const pool = Number(poolFrost) || 0;
  if (pool <= 0 || !frost) return { share: 0, tokens: 0 };
  const share = frost / pool;
  return { share, tokens: Math.floor(share * SEASON.budget) };
}
