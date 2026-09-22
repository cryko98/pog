/**
 * The snowball arena: two penguins, a stake each, winner takes the pool.
 *
 * ------------------------------------------------------------------ *
 * Why it is played the way it is
 * ------------------------------------------------------------------ *
 *
 * Presence is peer-to-peer and unauthenticated, so a real-time fight in
 * which a client reports "I hit them" cannot be made honest — either side
 * could say anything. What CAN be made honest is a fight resolved by the
 * server from sealed choices:
 *
 *   Each volley, both players secretly pick a throw (which lane, high or
 *   low) and a dodge (which lane to stand in, and whether to jump). Each
 *   sends a hash of the choice first, then the choice itself. The server
 *   checks the hash, resolves both throws at once, and scores the hits.
 *
 * Nobody can see the other's choice before committing to their own; nobody
 * can change a choice after seeing the other's; nobody can claim a hit the
 * server did not score. The client's job is only to animate what the
 * server decided. It plays like a penalty shoot-out with snowballs: read
 * your opponent, and do not be read.
 *
 * Stakes are escrowed before the first volley — soft resources on the
 * server, the real token in the arena's pool wallet on chain — so a loser
 * cannot walk away with what they put up.
 */

import { MEMO_PROGRAM, flattenInstructions, ownerDelta } from './sale.js';

export const DUEL = {
  /** volleys in a match, then sudden death until somebody leads */
  volleys: 10,
  maxVolleys: 20,
  /** how long each side has to seal a choice, then to open it */
  commitMs: 7000,
  revealMs: 4000,
  /** volleys you may sit out (no commit, or no reveal) before you forfeit */
  strikes: 3,
  /** a challenge nobody takes lapses on its own */
  openMs: 30 * 60 * 1000,
  /** how long both sides have to put their real-token stakes in the pool */
  fundMs: 10 * 60 * 1000,
  /** taken off soft $POG stakes and burned — the cost of a wash */
  rake: 0.05,
  /** the most of each thing one match may be played for */
  maxStake: { wood: 2000, ice: 2000, fish: 500, pog: 50_000 },
  /** real-token stakes, in whole tokens */
  minTokens: 1,
  maxTokens: 100_000_000,
};

export const LANES = ['left', 'centre', 'right'];
export const HEIGHTS = ['low', 'high'];
export const STAKE_KEYS = ['wood', 'ice', 'fish', 'pog'];

/** What one side chooses for a volley. */
export function validChoice(c) {
  return (
    !!c &&
    typeof c === 'object' &&
    LANES.includes(c.throwLane) &&
    HEIGHTS.includes(c.throwHeight) &&
    LANES.includes(c.dodgeLane) &&
    typeof c.jump === 'boolean'
  );
}

/** The exact string that gets hashed, so both sides agree on it. */
export const choiceString = (c, nonce) =>
  `${c.throwLane}:${c.throwHeight}:${c.dodgeLane}:${c.jump ? 1 : 0}:${nonce}`;

/** sha256 hex of a choice string — works in the browser and in Node. */
export async function commitHash(c, nonce) {
  const bytes = new TextEncoder().encode(choiceString(c, nonce));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Does a throw land? Same lane, and the dodge does not beat the height: a
 * jump clears a low ball but meets a high one; standing still meets both.
 */
export function throwLands(throwLane, throwHeight, dodgeLane, jump) {
  if (throwLane !== dodgeLane) return false;
  if (!jump) return true;
  return throwHeight === 'high';
}

/** Resolve one volley. `a`/`b` are choices, or null when a side sat it out. */
export function resolveVolley(a, b) {
  const hitOnB = a ? throwLands(a.throwLane, a.throwHeight, b?.dodgeLane ?? 'centre', b?.jump ?? false) : false;
  const hitOnA = b ? throwLands(b.throwLane, b.throwHeight, a?.dodgeLane ?? 'centre', a?.jump ?? false) : false;
  return { aHits: hitOnB ? 1 : 0, bHits: hitOnA ? 1 : 0 };
}

/** Is the match decided after this many volleys at these scores? */
export function decided(volleysPlayed, a, b) {
  if (volleysPlayed < DUEL.volleys) return false;
  if (a !== b) return true;
  return volleysPlayed >= DUEL.maxVolleys; // a draw, stakes go back
}

/**
 * A soft stake: whole non-negative amounts of the four resources, at least
 * one of them, none above the ceiling.
 */
export function normalizeStake(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return { error: 'Put something up.' };
  let any = false;
  for (const key of STAKE_KEYS) {
    const n = Math.floor(Number(raw[key]) || 0);
    if (n < 0) return { error: 'Stakes cannot be negative.' };
    if (n > DUEL.maxStake[key]) return { error: `At most ${DUEL.maxStake[key]} ${key} per match.` };
    if (n > 0) {
      out[key] = n;
      any = true;
    }
  }
  if (!any) return { error: 'Put something up.' };
  return { stake: out };
}

/** The memo a real-token deposit must carry: this match, this player. */
export const duelMemo = (id, wallet) => `pog-duel:${id}:${wallet}`;

/**
 * Judge a deposit into the pool wallet, from `getTransaction` with
 * jsonParsed encoding. Same discipline as the igloo sale: the depositor
 * signed, the memo names this match and this player, the pool's balance
 * of the mint rose by at least the stake.
 */
export function verifyDepositTx(tx, { wallet, pool, mint, memo, amountRaw }) {
  if (!tx || typeof tx !== 'object') return { ok: false, reason: 'No such transaction.' };
  const meta = tx.meta;
  const message = tx.transaction?.message;
  if (!meta || !message) return { ok: false, reason: 'Malformed transaction.' };
  if (meta.err != null) return { ok: false, reason: 'That transaction failed on chain.' };

  const keys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  if (!keys.some((k) => k && k.signer === true && k.pubkey === wallet)) {
    return { ok: false, reason: 'You did not sign that transaction.' };
  }

  const memos = flattenInstructions(tx)
    .filter((ix) => ix.programId === MEMO_PROGRAM || ix.program === 'spl-memo')
    .map((ix) => (typeof ix.parsed === 'string' ? ix.parsed : ''));
  if (!memos.includes(memo)) return { ok: false, reason: 'That payment is not for this match.' };

  if (ownerDelta(meta, mint, pool) < amountRaw) {
    return { ok: false, reason: 'The pool did not receive the stake.' };
  }
  return { ok: true };
}
