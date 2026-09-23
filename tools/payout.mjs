/**
 * Send queued arena payouts from the pool wallet.
 *
 *   node tools/payout.mjs                      dry run: list what would be sent
 *   ARENA_POOL_KEYPAIR=~/pool.json node tools/payout.mjs --send
 *
 * Used when the server has no POG_ARENA_POOL_KEYPAIR and payouts queue in
 * Redis instead. Reads the pool's keypair from a FILE PATH, never from an
 * argument; refuses to send without --send; marks each entry paid with its
 * signature so a re-run never pays twice.
 *
 * Needs the same Redis credentials as the API (pull them with
 * `vercel env pull .vercel/.env.prod`), POG_MINT and SOLANA_RPC_URL.
 */

import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { Redis } from '@upstash/redis';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';

config({ path: '.vercel/.env.prod' });
config();

const SEND = process.argv.includes('--send');
const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const MINT = (process.env.POG_MINT || '').trim();
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
// arena stakes land in the airdrop wallet unless a separate pool is set
const OWN_POOL = (process.env.POG_ARENA_POOL || '').trim();
const POOL = OWN_POOL.length >= 32 ? OWN_POOL : (process.env.POG_AIRDROP_WALLET || '').trim();

if (!url || !token) throw new Error('No Redis credentials in the environment.');
if (!MINT) throw new Error('POG_MINT is not set.');
if (POOL.length < 32) throw new Error('Neither POG_ARENA_POOL nor POG_AIRDROP_WALLET is set.');

const redis = new Redis({ url, token });
const rows = (await redis.lrange('pog:payouts', 0, -1)).map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
const queued = rows.map((p, i) => ({ ...p, index: i })).filter((p) => p.status === 'queued');

console.log(`${rows.length} payout entries, ${queued.length} queued`);
for (const p of queued) console.log(`  ${p.kind.padEnd(6)} ${p.amount.toString().padStart(12)} $POG -> ${p.to}  (match ${p.match})`);
if (!queued.length) process.exit(0);

if (!SEND) {
  console.log('\nDry run. Add --send with ARENA_POOL_KEYPAIR=<file> to pay these out.');
  process.exit(0);
}

const keyPath = process.env.ARENA_POOL_KEYPAIR;
if (!keyPath) throw new Error('ARENA_POOL_KEYPAIR (a file path) is required with --send.');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, 'utf8'))));
if (kp.publicKey.toBase58() !== POOL) throw new Error('That keypair is not the pool wallet.');

const conn = new Connection(RPC, 'confirmed');
const mintKey = new PublicKey(MINT);
const mintAcct = await conn.getAccountInfo(mintKey);
const program = mintAcct?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
const mint = await getMint(conn, mintKey, 'confirmed', program);
const fromAta = getAssociatedTokenAddressSync(mintKey, kp.publicKey, false, program);

for (const p of queued) {
  const to = new PublicKey(p.to);
  const toAta = getAssociatedTokenAddressSync(mintKey, to, false, program);
  const amount = BigInt(Math.floor(p.amount)) * 10n ** BigInt(mint.decimals);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mintKey, program),
    createTransferCheckedInstruction(fromAta, mintKey, toAta, kp.publicKey, amount, mint.decimals, [], program)
  );
  const sig = await conn.sendTransaction(tx, [kp]);
  await conn.confirmTransaction(sig, 'finalized');
  // mark it paid in place, so a re-run skips it
  await redis.lset('pog:payouts', p.index, { ...p, index: undefined, status: 'paid', signature: sig });
  // no longer held for the match, so the airdrop budget may count it again
  await redis.incrby('pog:escrow', -Math.floor(p.amount));
  console.log(`  paid ${p.amount} -> ${p.to}  ${sig}`);
}
console.log('done');
