/**
 * The snowball arena: two penguins, a stake each, winner takes the pool.
 *
 * The fight itself — the side-on, real-time part — lives in `fight.js`.
 * This file is the frame around it: what may be staked, how long things
 * wait, and how a real-token stake is proven on chain.
 *
 * Stakes are escrowed before the first throw — soft resources on the
 * server, the real token in the arena's pool wallet on chain — so a loser
 * cannot walk away with what they put up.
 */

import { MEMO_PROGRAM, flattenInstructions, ownerDelta } from './sale.js';

export const DUEL = {
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

export const STAKE_KEYS = ['wood', 'ice', 'fish', 'pog'];

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
