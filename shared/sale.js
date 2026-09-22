/**
 * Selling an igloo for real $POG — the on-chain kind.
 *
 * ------------------------------------------------------------------ *
 * The shape of it, and why
 * ------------------------------------------------------------------ *
 *
 * The server holds no keys, so it cannot escrow tokens. What it can do is
 * VERIFY: the buyer pays the seller directly, wallet to wallet, and hands
 * the server the transaction signature. The server fetches that transaction
 * from the chain itself — never trusting anything the client says about
 * it — and hands over the igloo only if the transaction is exactly the one
 * it asked for:
 *
 *   1. it succeeded, and it is final (not merely seen)
 *   2. the buyer signed it
 *   3. it carries a memo naming THIS listing, so a payment for one sale can
 *      never be presented as payment for another
 *   4. the seller's balance of the $POG mint rose by the take-home amount
 *   5. the buyer BURNED the house cut — the fee that makes a wash trade
 *      cost something is paid on chain too, where it cannot be refunded
 *   6. the signature has never been used before
 *
 * Before paying, the buyer RESERVES the listing for ten minutes. While it
 * is reserved the seller cannot unlist, move, or take anything out — the
 * buyer is paying for the igloo they looked at — and nobody else can buy
 * it. If the buyer never pays, the reservation lapses on its own.
 *
 * The two ledgers stay apart. A real-token sale moves the igloo and nothing
 * else: no soft $POG changes hands, and Frost is never involved.
 */

/** Written into the memo of every payment, so a payment names its sale. */
export const SALE_MEMO_PREFIX = 'pog-igloo';
/** The house cut, burned by the buyer in the same transaction. */
export const SALE_FEE = 0.08;
/** Asking prices, in whole tokens. */
export const SALE_MIN = 1;
export const SALE_MAX = 1_000_000_000;
/** How long a buyer may hold a listing while they pay. */
export const RESERVE_MS = 10 * 60 * 1000;

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** The memo a payment for this listing must carry. */
export const saleMemo = (seller, listedAt) => `${SALE_MEMO_PREFIX}:${seller}:${listedAt}`;

/** How a price splits: what the seller gets, and what the buyer burns. */
export function saleSplit(price) {
  const whole = Math.floor(Number(price) || 0);
  const burn = Math.max(1, Math.round(whole * SALE_FEE));
  return { price: whole, burn, takeHome: Math.max(0, whole - burn) };
}

/** Whole tokens -> base units, as a string of digits (may exceed 2^53). */
export function toBaseUnits(whole, decimals) {
  return BigInt(Math.floor(Number(whole) || 0)) * 10n ** BigInt(decimals);
}

/**
 * Judge a transaction, as returned by `getTransaction` with
 * `encoding: 'jsonParsed'`, against the sale it is supposed to settle.
 *
 * Returns { ok: true } or { ok: false, reason }. Pure, so it can be tested
 * against fixtures without a chain in the room — which is the only way it
 * gets tested before the token exists.
 */
export function verifySaleTx(tx, terms) {
  const { buyer, seller, mint, memo, takeHomeRaw, burnRaw, listedAt } = terms;
  if (!tx || typeof tx !== 'object') return { ok: false, reason: 'No such transaction.' };

  const meta = tx.meta;
  const message = tx.transaction?.message;
  if (!meta || !message) return { ok: false, reason: 'Malformed transaction.' };
  if (meta.err != null) return { ok: false, reason: 'That transaction failed on chain.' };

  // It has to be the buyer's own transaction. Not for the money — the
  // balances below settle that — but a payment somebody else signed is not
  // the buyer's consent to this sale.
  const keys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const signedByBuyer = keys.some((k) => k && k.signer === true && k.pubkey === buyer);
  if (!signedByBuyer) return { ok: false, reason: 'The buyer did not sign that transaction.' };

  // A payment made before the listing existed cannot be a payment for it.
  const blockTime = Number(tx.blockTime) || 0;
  if (blockTime > 0 && blockTime * 1000 < listedAt - 5 * 60 * 1000) {
    return { ok: false, reason: 'That payment predates the listing.' };
  }

  const all = flattenInstructions(tx);

  // 3. the memo names this listing
  const memos = all
    .filter((ix) => ix.programId === MEMO_PROGRAM || ix.program === 'spl-memo')
    .map((ix) => (typeof ix.parsed === 'string' ? ix.parsed : ''));
  if (!memos.includes(memo)) return { ok: false, reason: 'That payment is not for this listing.' };

  // 4. the seller's holding of the mint rose by at least the take-home
  const delta = ownerDelta(meta, mint, seller);
  if (delta < takeHomeRaw) {
    return { ok: false, reason: 'The seller was not paid the asking price.' };
  }

  // 5. the buyer burned the house cut, in an instruction the buyer authorised
  const burned = all
    .filter((ix) => (ix.program === 'spl-token' || ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM))
    .filter((ix) => ix.parsed?.type === 'burn' || ix.parsed?.type === 'burnChecked')
    .filter((ix) => ix.parsed?.info?.mint === mint && ix.parsed?.info?.authority === buyer)
    .reduce((sum, ix) => sum + rawAmount(ix.parsed.info), 0n);
  if (burned < burnRaw) return { ok: false, reason: 'The house cut was not burned.' };

  return { ok: true };
}

/** Top-level and inner instructions together, in one list. */
function flattenInstructions(tx) {
  const top = tx.transaction?.message?.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((g) => g?.instructions ?? []);
  return [...top, ...inner].filter((ix) => ix && typeof ix === 'object');
}

/** Base units moved, from a parsed token instruction's `info`. */
function rawAmount(info) {
  if (!info) return 0n;
  if (info.tokenAmount?.amount != null) return BigInt(String(info.tokenAmount.amount));
  if (info.amount != null) return BigInt(String(info.amount));
  return 0n;
}

/**
 * How much of `mint` an OWNER holds after the transaction, minus before,
 * summed across all their token accounts. Pre/post balances are what the
 * validator itself recorded, so they cannot be dressed up by the sender.
 */
function ownerDelta(meta, mint, owner) {
  const sum = (rows) =>
    (rows ?? [])
      .filter((b) => b && b.mint === mint && b.owner === owner)
      .reduce((s, b) => s + BigInt(String(b.uiTokenAmount?.amount ?? '0')), 0n);
  return sum(meta.postTokenBalances) - sum(meta.preTokenBalances);
}
