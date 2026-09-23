/**
 * The casino's rules, shared by the client (to show them) and the server
 * (to settle by them). Every game is one roll of a number in [0, 1) that
 * the server draws from a seed it committed to in advance — see
 * `server/casino.ts` — and a choice the player made before the roll.
 *
 * P coins only. Nothing here touches the token or Frost.
 */

export const CASINO = {
  minWager: 1,
  maxWager: 2000,
  /** bets per wallet per minute */
  betsPerMin: 20,
  /** the house keeps this share of the fair payout, and it is burned */
  edge: 0.03,
};

export const GAMES = {
  flip: {
    id: 'flip',
    label: 'Snowflake flip',
    blurb: 'Ice or fire. Call it right and the wager comes back nearly doubled.',
    choices: ['ice', 'fire'],
  },
  dice: {
    id: 'dice',
    label: 'Ice dice',
    blurb: 'Pick a number from 2 to 96. The roll comes up 0–99; under your number wins. The lower you go, the more it pays.',
    choices: null, // an integer 2..96
  },
  race: {
    id: 'race',
    label: 'Bear race',
    blurb: 'Three bears, one lane wins. Pick yours.',
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
  return Number.isInteger(n) && n >= 2 && n <= 96 ? String(n) : null;
}

/** The multiplier paid on a win, house edge taken off the fair odds. */
export function multiplierOf(game, choice) {
  const fair = game === 'flip' ? 2 : game === 'race' ? 3 : 100 / Number(choice);
  return Math.floor(fair * (1 - CASINO.edge) * 100) / 100;
}

/**
 * Settle one roll. `roll` is in [0, 1). Returns what the roll "showed"
 * (for the table) and whether the choice won.
 */
export function outcomeOf(game, choice, roll) {
  if (game === 'flip') {
    const shown = roll < 0.5 ? 'ice' : 'fire';
    return { shown, won: shown === choice };
  }
  if (game === 'race') {
    const shown = String(1 + Math.floor(roll * 3));
    return { shown, won: shown === choice };
  }
  const shown = Math.floor(roll * 100); // 0..99
  return { shown: String(shown), won: shown < Number(choice) };
}
