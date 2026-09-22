/**
 * The on-chain side of the igloo market: reserving a listing, building the
 * payment for the buyer to sign, and settling once it is final.
 *
 * The design and the six checks are spelled out in `shared/sale.js`. The
 * short version: the server has no keys and escrows nothing. The buyer
 * pays the seller directly and burns the house cut in the same transaction;
 * the server reads that transaction back from the chain and hands over the
 * igloo only if it is exactly the one it asked for.
 *
 * Nothing here moves soft $POG, and nothing here touches Frost.
 */

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { kv } from './kv.js';
import { withWallets } from './lock.js';
import { POG_MINT, chainLive, finalizedTransaction, latestBlockhash, mintInfo } from './chain.js';
import { K, getProfile, type Igloo } from './game.js';
import {
  MEMO_PROGRAM,
  RESERVE_MS,
  saleMemo,
  saleSplit,
  toBaseUnits,
  verifySaleTx,
} from '../../shared/sale.js';
import type { Listing } from './home.js';

export interface Reservation {
  buyer: string;
  seller: string;
  listedAt: number;
  price: number;
  expiresAt: number;
}

/** A settled sale, kept for the audit trail. */
export interface SaleRecord {
  seller: string;
  buyer: string;
  price: number;
  burn: number;
  signature: string;
  listedAt: number;
  at: number;
}

const SALES_LOG = 'pog:sales';
const usedKey = (signature: string) => `pog:txused:${signature}`;

const listingOf = async (seller: string) => (await kv()).hget<Listing>(K.market, seller);

/** The live reservation on a listing, if any. */
export async function reservationOf(seller: string, listedAt: number): Promise<Reservation | null> {
  const r = await (await kv()).get<Reservation>(K.reserve(seller, listedAt));
  return r && r.expiresAt > Date.now() ? r : null;
}

/** Is this seller's listing held by a buyer right now? */
export async function isReserved(seller: string): Promise<boolean> {
  const listing = await listingOf(seller);
  if (!listing) return false;
  return (await reservationOf(seller, listing.listedAt)) != null;
}

/* ------------------------------------------------------------------ *
 * Reserve
 * ------------------------------------------------------------------ */

export async function reserveSale(
  buyer: string,
  sellerWallet: unknown
): Promise<{ reservation?: Reservation; error?: string }> {
  if (!chainLive()) return { error: 'The token is not live yet.' };
  if (typeof sellerWallet !== 'string' || !sellerWallet) return { error: 'No such listing.' };
  if (sellerWallet === buyer) return { error: 'It is already yours.' };

  return withWallets([buyer, sellerWallet], async () => {
    const store = await kv();
    const listing = await listingOf(sellerWallet);
    if (!listing) return { error: 'That one has gone.' };
    if (listing.currency !== 'pog') return { error: 'That one is sold for in-game $POG.' };
    if (!(await getProfile(buyer))) return { error: 'Pick a username first.' };
    if (await store.hget<Igloo>(K.igloos, buyer)) {
      return { error: 'You already have an igloo. Sell it first.' };
    }

    const key = K.reserve(sellerWallet, listing.listedAt);
    const now = Date.now();
    const reservation: Reservation = {
      buyer,
      seller: sellerWallet,
      listedAt: listing.listedAt,
      price: listing.price,
      expiresAt: now + RESERVE_MS,
    };

    // One buyer at a time. Coming back for your own live reservation is
    // fine — the wallet popup may have been dismissed — but not somebody
    // else's.
    if (!(await store.setnx(key, reservation, Math.ceil(RESERVE_MS / 1000)))) {
      const held = await reservationOf(sellerWallet, listing.listedAt);
      if (held && held.buyer === buyer) return { reservation: held };
      return { error: 'Somebody else is buying it right now.' };
    }
    return { reservation };
  });
}

/* ------------------------------------------------------------------ *
 * The invoice — an unsigned transaction for the buyer to sign
 * ------------------------------------------------------------------ */

export interface Invoice {
  /** base64 of the unsigned, serialised transaction */
  transaction: string;
  price: number;
  takeHome: number;
  burn: number;
  decimals: number;
  memo: string;
  expiresAt: number;
  lastValidBlockHeight: number;
}

/**
 * Build the payment. The buyer's wallet shows them exactly what this does
 * before they sign: create the seller's token account if it is missing,
 * transfer the take-home, burn the cut, and a memo naming the listing.
 * Nothing in it can move anything but the buyer's own tokens.
 */
export async function saleInvoice(buyer: string, sellerWallet: unknown): Promise<{ invoice?: Invoice; error?: string }> {
  if (!chainLive()) return { error: 'The token is not live yet.' };
  if (typeof sellerWallet !== 'string' || !sellerWallet) return { error: 'No such listing.' };

  const listing = await listingOf(sellerWallet);
  if (!listing || listing.currency !== 'pog') return { error: 'That one has gone.' };
  const held = await reservationOf(sellerWallet, listing.listedAt);
  if (!held || held.buyer !== buyer) return { error: 'Reserve it first.' };

  const [mint, recent] = await Promise.all([mintInfo(), latestBlockhash()]);
  if (!mint || !recent) return { error: 'Could not reach the chain. Try again in a moment.' };

  const program = mint.program === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintKey = new PublicKey(POG_MINT);
  const buyerKey = new PublicKey(buyer);
  const sellerKey = new PublicKey(sellerWallet);
  const buyerAta = getAssociatedTokenAddressSync(mintKey, buyerKey, false, program);
  const sellerAta = getAssociatedTokenAddressSync(mintKey, sellerKey, false, program);

  const split = saleSplit(listing.price);
  const memo = saleMemo(sellerWallet, listing.listedAt);

  const tx = new Transaction({
    feePayer: buyerKey,
    blockhash: recent.blockhash,
    lastValidBlockHeight: recent.lastValidBlockHeight,
  });
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(buyerKey, sellerAta, sellerKey, mintKey, program),
    createTransferCheckedInstruction(
      buyerAta,
      mintKey,
      sellerAta,
      buyerKey,
      toBaseUnits(split.takeHome, mint.decimals),
      mint.decimals,
      [],
      program
    ),
    createBurnCheckedInstruction(buyerAta, mintKey, buyerKey, toBaseUnits(split.burn, mint.decimals), mint.decimals, [], program),
    new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM),
      keys: [{ pubkey: buyerKey, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, 'utf8'),
    })
  );

  return {
    invoice: {
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
      price: split.price,
      takeHome: split.takeHome,
      burn: split.burn,
      decimals: mint.decimals,
      memo,
      expiresAt: held.expiresAt,
      lastValidBlockHeight: recent.lastValidBlockHeight,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Settle
 * ------------------------------------------------------------------ */

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

export async function settleSale(
  buyer: string,
  sellerWallet: unknown,
  signature: unknown
): Promise<{ igloo?: Igloo; pending?: boolean; error?: string }> {
  if (!chainLive()) return { error: 'The token is not live yet.' };
  if (typeof sellerWallet !== 'string' || !sellerWallet) return { error: 'No such listing.' };
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return { error: 'That is not a signature.' };

  // Read the chain OUTSIDE the locks — it can take seconds — then decide
  // inside them. The listing is re-read under the lock, so a seller cannot
  // slip anything past between the read and the transfer.
  const listing = await listingOf(sellerWallet);
  if (!listing || listing.currency !== 'pog') return { error: 'That one has gone.' };
  const mint = await mintInfo();
  if (!mint) return { error: 'Could not reach the chain. Try again in a moment.' };

  const tx = await finalizedTransaction(signature);
  if (tx === null) return { error: 'Could not reach the chain. Try again in a moment.' };
  if (tx === undefined) return { pending: true };

  const split = saleSplit(listing.price);
  const verdict = verifySaleTx(tx, {
    buyer,
    seller: sellerWallet,
    mint: POG_MINT,
    memo: saleMemo(sellerWallet, listing.listedAt),
    takeHomeRaw: toBaseUnits(split.takeHome, mint.decimals),
    burnRaw: toBaseUnits(split.burn, mint.decimals),
    listedAt: listing.listedAt,
  });
  if (!verdict.ok) return { error: verdict.reason };

  return withWallets([buyer, sellerWallet], async () => {
    const store = await kv();

    // 6. a signature settles one sale, ever
    if (!(await store.setnx(usedKey(signature), buyer, 365 * 24 * 3600))) {
      return { error: 'That payment has already been used.' };
    }

    const live = await listingOf(sellerWallet);
    const igloo = await store.hget<Igloo>(K.igloos, sellerWallet);
    // The memo pins the payment to ONE listing (seller + listedAt). If
    // that exact listing is gone, the payment cannot buy anything else —
    // and the seller could not have removed it while it was reserved.
    if (!live || live.listedAt !== listing.listedAt || live.currency !== 'pog' || !igloo) {
      await store.del(usedKey(signature));
      return { error: 'That listing is no longer available. Contact the seller about the payment.' };
    }
    if (await store.hget<Igloo>(K.igloos, buyer)) {
      await store.del(usedKey(signature));
      return { error: 'You already have an igloo.' };
    }

    const buyerProfile = await getProfile(buyer);
    const moved: Igloo = {
      ...igloo,
      wallet: buyer,
      owner: buyerProfile?.name || igloo.owner,
      lastYield: Date.now(),
    };
    await store.hdel(K.igloos, sellerWallet);
    await store.hset(K.igloos, buyer, moved);
    await store.hdel(K.market, sellerWallet);
    await store.del(K.reserve(sellerWallet, listing.listedAt));

    const record: SaleRecord = {
      seller: sellerWallet,
      buyer,
      price: split.price,
      burn: split.burn,
      signature,
      listedAt: listing.listedAt,
      at: Date.now(),
    };
    await store.rpushCapped(SALES_LOG, record, 5000);

    return { igloo: moved };
  });
}

/** The most recent on-chain sales, newest first. */
export async function recentSales(limit = 20): Promise<SaleRecord[]> {
  const rows = await (await kv()).lrange<SaleRecord>(SALES_LOG, -limit, -1);
  return rows.reverse();
}
