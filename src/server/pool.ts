/**
 * The arena's pool wallet: where real-token stakes land, and what pays
 * the winner out.
 *
 * Two modes, chosen by the environment:
 *
 *   POG_ARENA_POOL            the pool's public key. Required for any
 *                             real-token duel at all: stakes are paid to it.
 *   POG_ARENA_POOL_KEYPAIR    the pool's secret key as a JSON byte array.
 *                             With it, the winner is paid automatically the
 *                             moment the match ends. Without it, payouts
 *                             queue in Redis and `tools/payout.mjs` sends
 *                             them from a keypair file on the operator's
 *                             machine — the same shape as `send.mjs`.
 *
 * The hot key is the one real trade-off in this feature. Keep the pool
 * wallet holding stakes and nothing else, so the worst a leaked key can do
 * is empty the pool. Payouts are only ever created by `arena.ts` from a
 * settled match, for the verified deposit amounts, to the verified winner;
 * nothing here takes an amount or a recipient from a request.
 */

import bs58 from 'bs58';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { POG_MINT, chainLive, latestBlockhash, mintInfo, sendRawTransaction } from './chain.js';
import { toBaseUnits } from '../../shared/sale.js';

/** the play-to-earn allocation: where the daily payouts come from */
const AIRDROP_WALLET = (process.env.POG_AIRDROP_WALLET || '').trim();
/**
 * Where real-token arena stakes go. By default the airdrop wallet itself:
 * a stake sits there as escrow (counted in `pog:escrow`, never in the
 * airdrop's budget) until the match pays it back out. A separate pool
 * wallet can still be set with POG_ARENA_POOL + POG_ARENA_POOL_KEYPAIR.
 */
const OWN_POOL = (process.env.POG_ARENA_POOL || '').trim();
const POOL = OWN_POOL.length >= 32 ? OWN_POOL : AIRDROP_WALLET;

/** whole tokens sitting in the pool for arena matches, not yet paid back out */
export const ESCROW_KEY = 'pog:escrow';

export const poolAddress = () => POOL;
/** true when arena stakes land in the airdrop wallet, so its budget must leave them out */
export const poolIsAirdrop = () => POOL.length >= 32 && POOL === AIRDROP_WALLET;
/** Real-token duels need the mint AND somewhere for the stakes to go. */
export const poolReady = () => chainLive() && POOL.length >= 32;

/**
 * A secret key from the environment, in either shape a wallet hands out:
 * the Solana CLI's JSON byte array (`[12,34,...]`, the contents of
 * `id.json`) or the base58 string Phantom and Solflare export.
 */
function keypairFrom(envName: string, expected: string): Keypair | null {
  const raw = (process.env[envName] || '').trim();
  if (!raw || !expected) return null;
  try {
    const bytes = raw.startsWith('[') ? (JSON.parse(raw) as number[]) : Array.from(bs58.decode(raw));
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    // the key must be THAT wallet's key, not some other wallet's
    return kp.publicKey.toBase58() === expected ? kp : null;
  } catch {
    return null;
  }
}

const signer = () => (POOL === AIRDROP_WALLET ? keypairFrom('POG_AIRDROP_KEYPAIR', AIRDROP_WALLET) : keypairFrom('POG_ARENA_POOL_KEYPAIR', POOL));
const airdropSigner = () => keypairFrom('POG_AIRDROP_KEYPAIR', AIRDROP_WALLET);

export const canPayAutomatically = () => signer() !== null;

export const airdropAddress = () => AIRDROP_WALLET;
/** Daily payouts need the mint and a wallet to pay from. */
export const airdropReady = () => chainLive() && AIRDROP_WALLET.length >= 32;
export const canPayAirdrop = () => airdropReady() && airdropSigner() !== null;

/**
 * Send `amount` whole tokens from the pool to `to`. Returns the signature,
 * or null when it could not be sent (no key, chain unreachable) — the
 * caller then queues it instead. Never throws.
 */
export async function payFromPool(to: string, amount: number): Promise<string | null> {
  const kp = signer();
  if (!kp || !poolReady() || !(amount > 0)) return null;
  return transfer(kp, to, amount);
}

/** The same, from the airdrop wallet. Only `airdrop.ts` calls this, for amounts it computed. */
export async function payFromAirdrop(to: string, amount: number): Promise<string | null> {
  const kp = airdropSigner();
  if (!kp || !airdropReady() || !(amount > 0)) return null;
  return transfer(kp, to, amount);
}

async function transfer(kp: Keypair, to: string, amount: number): Promise<string | null> {
  const [mint, recent] = await Promise.all([mintInfo(), latestBlockhash()]);
  if (!mint || !recent) return null;

  try {
    const program = mint.program === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const mintKey = new PublicKey(POG_MINT);
    const toKey = new PublicKey(to);
    const fromAta = getAssociatedTokenAddressSync(mintKey, kp.publicKey, false, program);
    const toAta = getAssociatedTokenAddressSync(mintKey, toKey, false, program);

    const tx = new Transaction({
      feePayer: kp.publicKey,
      blockhash: recent.blockhash,
      lastValidBlockHeight: recent.lastValidBlockHeight,
    });
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, toKey, mintKey, program),
      createTransferCheckedInstruction(fromAta, mintKey, toAta, kp.publicKey, toBaseUnits(amount, mint.decimals), mint.decimals, [], program)
    );
    tx.sign(kp);
    return await sendRawTransaction(tx.serialize().toString('base64'));
  } catch {
    return null;
  }
}
