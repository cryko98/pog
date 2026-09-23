/**
 * The casino's rules, shared by the client (to show them) and the server
 * (to settle by them). Every hand is one server roll — a number in [0, 1)
 * plus the digest it came from, drawn from a seed the server committed to
 * in advance (see `server/casino.ts`) — and a choice the player made
 * before the roll.
 *
 * The tables are built so that a player wins fewer hands than they lose:
 * the flip has a third face that beats both calls, the dice only take a
 * number under 49, and the race has three bears. On top of that the house
 * keeps `edge` of the fair payout and burns it.
 *
 * P coins only. Nothing here touches the token or Frost.
 */

export const CASINO = {
  minWager: 1,
  maxWager: 2000,
  /** bets per wallet per minute */
  betsPerMin: 20,
  /** the house keeps this share of the fair payout, and it is burned */
  edge: 0.08,
  /** the flip's third face: neither ice nor fire, and nobody wins */
  meltChance: 0.08,
  /** the dice: pick a number from 2 up to this; the roll must come under it */
  diceMax: 48,
};

export const GAMES = {
  flip: {
    id: 'flip',
    label: 'Snowflake flip',
    blurb: 'Ice or fire — call it. Now and then the flake melts, and that beats both calls.',
    choices: ['ice', 'fire'],
  },
  dice: {
    id: 'dice',
    label: 'Ice dice',
    blurb: 'Pick a number from 2 to 48. The dice roll 0–99; under your number wins. The lower you go, the more it pays.',
    choices: null, // an integer 2..diceMax
  },
  race: {
    id: 'race',
    label: 'Bear race',
    blurb: 'Three polar bears, one track, one winner. Every bear runs its own race — pick yours before the gate.',
    choices: ['1', '2', '3'],
  },
};

/**
 * Whether the choice is valid for the game, normalised.
 * Returns null when it is not.
 */
export function normaliseChoice(game, choice) {
  const g = GAMES[game];
  if (!g) return null;
  if (g.choices) return g.choices.includes(String(choice)) ? String(choice) : null;
  const n = Math.floor(Number(choice));
  return Number.isInteger(n) && n >= 2 && n <= CASINO.diceMax ? String(n) : null;
}

/** The chance of winning a hand, before the edge. */
export function chanceOf(game, choice) {
  if (game === 'flip') return (1 - CASINO.meltChance) / 2;
  if (game === 'race') return 1 / 3;
  return Number(choice) / 100;
}

/** The multiplier paid on a win: fair odds for the chance, less the house edge. */
export function multiplierOf(game, choice) {
  const fair = 1 / chanceOf(game, choice);
  return Math.floor(fair * (1 - CASINO.edge) * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * The race
 *
 * A real race, not a lookup: each bear gets its own pace for each of
 * `RACE.legs` legs of the track, every pace a byte of the roll's digest,
 * and the winner is simply whichever bear reaches the line first. The
 * client animates exactly these paces, so what you watch is what won.
 * ------------------------------------------------------------------ */

export const RACE = {
  lanes: 3,
  legs: 8,
  /** the track, in the units the paces are measured in */
  length: 1000,
  /** paces run from `pace.min` to `pace.max` units per second */
  pace: { min: 150, max: 340 },
};

/**
 * From a hex digest, every bear's pace per leg and its finish time.
 * Returns `{ paces: number[][], times: number[], winner: '1'|'2'|'3' }`.
 */
export function simulateRace(digestHex) {
  const bytes = [];
  for (let i = 0; i + 1 < digestHex.length; i += 2) bytes.push(parseInt(digestHex.slice(i, i + 2), 16));
  // 3 lanes × 8 legs = 24 bytes of a 32-byte digest; a short digest wraps
  const at = (i) => bytes[i % bytes.length] || 0;
  const leg = RACE.length / RACE.legs;
  const paces = [];
  const times = [];
  for (let lane = 0; lane < RACE.lanes; lane++) {
    const mine = [];
    let t = 0;
    for (let k = 0; k < RACE.legs; k++) {
      const b = at(lane * RACE.legs + k);
      const pace = RACE.pace.min + (b / 255) * (RACE.pace.max - RACE.pace.min);
      mine.push(Math.round(pace));
      t += leg / pace;
    }
    paces.push(mine);
    times.push(Math.round(t * 1000) / 1000);
  }
  // a dead heat goes to the lower lane, which is decided before the bet
  let winner = 0;
  for (let i = 1; i < RACE.lanes; i++) if (times[i] < times[winner]) winner = i;
  return { paces, times, winner: String(winner + 1) };
}

/**
 * Settle one hand. `roll` is in [0, 1); `digest` is the hex the roll came
 * from (the race runs on it). Returns what the table showed and whether
 * the choice won, plus the race when there was one.
 */
export function outcomeOf(game, choice, roll, digest = '') {
  if (game === 'flip') {
    const shown = roll < CASINO.meltChance ? 'melt' : roll < CASINO.meltChance + (1 - CASINO.meltChance) / 2 ? 'ice' : 'fire';
    return { shown, won: shown === choice };
  }
  if (game === 'race') {
    const race = simulateRace(digest);
    return { shown: race.winner, won: race.winner === choice, race };
  }
  const shown = Math.floor(roll * 100); // 0..99
  return { shown: String(shown), won: shown < Number(choice) };
}
