/**
 * Pays out a season snapshot in $POG.
 *
 *   node tools/send.mjs                          # dry run — reports, sends nothing
 *   node tools/send.mjs --send                   # actually transfer
 *   node tools/send.mjs --send --limit 25        # a small first batch
 *
 * ------------------------------------------------------------------ *
 * Read this before running it with --send
 * ------------------------------------------------------------------ *
 *
 * This moves real money and cannot be undone. It is built to be boring
 * about that:
 *
 *  - dry run is the DEFAULT. `--send` is the only way to transfer.
 *  - it never sees a private key it was not pointed at. Set
 *    TREASURY_KEYPAIR to the path of a Solana CLI keypair JSON file.
 *    Nothing is read from a prompt, an argument or a config file.
 *  - every confirmed signature is appended to `<snapshot>.sent.json`
 *    before the next batch starts. Re-running SKIPS anyone already in
 *    that log, so a crash, a timeout or a Ctrl-C costs you nothing and
 *    nobody is paid twice. Do not delete that file.
 *  - it preflights the treasury balance, the SOL for fees, and the rent
 *    for any token accounts that need creating, and refuses to start if
 *    any of them is short.
 *  - `--send` requires typing the season name to confirm.
 *
 * Recipients almost always already have a $POG token account, because
 * qualifying for Frost required holding $POG. Any that do not are listed
 * in the dry run with the rent it will cost to create them.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';
import { SEASON } from '../shared/season.js';

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

const argOf = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);

const LIVE = has('--send');
const LIMIT = Number(argOf('--limit', '0')) || Infinity;
/** Transfers per transaction. Conservative: a tx has a hard size limit and
 *  an ATA creation is much bigger than a transfer. */
const PER_TX = Math.max(1, Math.min(10, Number(argOf('--batch', '8')) || 8));

const SNAPSHOT = argOf('--snapshot', `snapshots/season-${SEASON.id}.json`);
const SENT_LOG = SNAPSHOT.replace(/\.json$/, '') + '.sent.json';

const MINT = (process.env.POG_MINT || '').trim();
const RPC = (process.env.SOLANA_RPC_URL || '').trim();
const KEYPAIR_PATH = (process.env.TREASURY_KEYPAIR || '').trim();

const die = (msg) => {
  console.error('\n' + msg + '\n');
  process.exit(1);
};

if (!existsSync(SNAPSHOT)) die(`No snapshot at ${SNAPSHOT}. Run tools/snapshot.mjs first.`);
if (!MINT) die('POG_MINT is not set. Export it, or pass --env-file with it in.');
if (!RPC) die('SOLANA_RPC_URL is not set. Use a paid RPC — the public one will rate-limit this.');
if (LIVE && !KEYPAIR_PATH) {
  die(
    'TREASURY_KEYPAIR is not set.\n' +
      'Point it at a Solana CLI keypair JSON file, e.g.\n' +
      '  TREASURY_KEYPAIR=~/.config/solana/treasury.json node tools/send.mjs --send'
  );
}

const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
if (snap.season?.id !== SEASON.id) {
  die(
    `That snapshot is for season ${snap.season?.id}, but shared/season.js says ${SEASON.id}.\n` +
      'Refusing to pay out a season the code no longer describes.'
  );
}

/** wallet -> signature, for everyone already paid. */
const sent = existsSync(SENT_LOG) ? JSON.parse(readFileSync(SENT_LOG, 'utf8')) : {};
const recordSent = (wallet, signature) => {
  sent[wallet] = { signature, at: new Date().toISOString() };
  writeFileSync(SENT_LOG, JSON.stringify(sent, null, 2) + '\n');
};

/* ------------------------------------------------------------------ *
 * Work out what is left to do
 * ------------------------------------------------------------------ */

const connection = new Connection(RPC, 'confirmed');
const mint = new PublicKey(MINT);
const mintInfo = await getMint(connection, mint);
const DECIMALS = mintInfo.decimals;
const base = (whole) => BigInt(whole) * 10n ** BigInt(DECIMALS);

const pending = [];
let skippedPaid = 0;
let skippedZero = 0;
let invalid = 0;

for (const entry of snap.entries) {
  if (pending.length >= LIMIT) break;
  if (sent[entry.wallet]) {
    skippedPaid++;
    continue;
  }
  if (!entry.tokens || entry.tokens <= 0) {
    skippedZero++;
    continue;
  }
  let owner;
  try {
    owner = new PublicKey(entry.wallet);
    // A payout address must be a normal wallet. Sending to something that
    // sits on the ed25519 curve's off-curve set is how tokens get burned
    // by accident.
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error('off curve');
  } catch {
    console.error(`  ! ${entry.wallet} is not a valid wallet address — skipping`);
    invalid++;
    continue;
  }
  pending.push({ ...entry, owner });
}

if (!pending.length) {
  console.log(
    `Nothing to send. ${skippedPaid} already paid, ${skippedZero} allotted nothing, ${invalid} invalid.`
  );
  process.exit(0);
}

console.log(`Season ${snap.season.id} — ${snap.season.name}`);
console.log(`  snapshot      ${SNAPSHOT}`);
console.log(`  mint          ${MINT}  (${DECIMALS} decimals)`);
console.log(`  to pay        ${pending.length}`);
if (skippedPaid) console.log(`  already paid  ${skippedPaid}   (from ${SENT_LOG})`);
if (skippedZero) console.log(`  zero allotted ${skippedZero}`);
if (invalid) console.log(`  invalid       ${invalid}`);

/* --- which recipients need a token account creating ----------------- */

process.stdout.write('\nChecking recipient token accounts… ');
let needsAta = 0;
for (const p of pending) {
  p.ata = await getAssociatedTokenAddress(mint, p.owner);
  try {
    await getAccount(connection, p.ata);
    p.hasAta = true;
  } catch {
    p.hasAta = false;
    needsAta++;
  }
}
console.log(`${pending.length - needsAta} exist, ${needsAta} to create`);

const totalTokens = pending.reduce((s, p) => s + BigInt(p.tokens), 0n);
// Rent for a token account, plus a rough fee per transaction.
const ATA_RENT_LAMPORTS = 2_039_280;
const txCount = Math.ceil(pending.length / PER_TX);
const solNeeded = (needsAta * ATA_RENT_LAMPORTS + txCount * 5000) / 1e9;

console.log(`\n  tokens to send   ${totalTokens.toLocaleString('en-US')} $POG`);
console.log(`  transactions     ~${txCount}  (${PER_TX} per tx)`);
console.log(`  SOL needed       ~${solNeeded.toFixed(4)}  (rent for ${needsAta} accounts + fees)`);

/* ------------------------------------------------------------------ *
 * Dry run stops here
 * ------------------------------------------------------------------ */

if (!LIVE) {
  console.log('\nFirst ten:');
  for (const p of pending.slice(0, 10)) {
    console.log(
      `  ${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}  ${String(p.tokens).padStart(10)} $POG  ` +
        `${p.name || '—'}${p.hasAta ? '' : '  (needs an account)'}`
    );
  }
  console.log('\nDRY RUN — nothing was sent. Add --send to transfer.');
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * Live: preflight the treasury, confirm, then send
 * ------------------------------------------------------------------ */

const secret = JSON.parse(readFileSync(KEYPAIR_PATH.replace(/^~/, process.env.HOME || '~'), 'utf8'));
const treasury = Keypair.fromSecretKey(Uint8Array.from(secret));
const treasuryAta = await getAssociatedTokenAddress(mint, treasury.publicKey);

let treasuryTokens = 0n;
try {
  treasuryTokens = (await getAccount(connection, treasuryAta)).amount;
} catch {
  die(`The treasury ${treasury.publicKey.toBase58()} holds no $POG account.`);
}
const treasurySol = await connection.getBalance(treasury.publicKey);

console.log(`\n  treasury         ${treasury.publicKey.toBase58()}`);
console.log(`  holds            ${(treasuryTokens / 10n ** BigInt(DECIMALS)).toLocaleString('en-US')} $POG`);
console.log(`  holds            ${(treasurySol / 1e9).toFixed(4)} SOL`);

if (treasuryTokens < base(totalTokens)) {
  die(
    `The treasury is short. Needs ${totalTokens.toLocaleString('en-US')} $POG, ` +
      `holds ${(treasuryTokens / 10n ** BigInt(DECIMALS)).toLocaleString('en-US')}.`
  );
}
if (treasurySol < solNeeded * 1e9 * 1.2) {
  die(`Not enough SOL for fees and rent. Needs about ${(solNeeded * 1.2).toFixed(4)}.`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `\nThis will send ${totalTokens.toLocaleString('en-US')} $POG to ${pending.length} wallets.\n` +
    `It cannot be undone. Type the season name ("${snap.season.name}") to go ahead: `
);
rl.close();
if (answer.trim() !== snap.season.name) die('Not confirmed. Nothing was sent.');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let paid = 0;
let failed = 0;

for (let i = 0; i < pending.length; i += PER_TX) {
  const batch = pending.slice(i, i + PER_TX);
  const tx = new Transaction();

  for (const p of batch) {
    if (!p.hasAta) {
      tx.add(createAssociatedTokenAccountInstruction(treasury.publicKey, p.ata, p.owner, mint));
    }
    tx.add(
      createTransferCheckedInstruction(
        treasuryAta,
        mint,
        p.ata,
        treasury.publicKey,
        base(p.tokens),
        DECIMALS,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  const label = `batch ${Math.floor(i / PER_TX) + 1}/${txCount}`;
  let signature = null;
  for (let attempt = 1; attempt <= 3 && !signature; attempt++) {
    try {
      signature = await sendAndConfirmTransaction(connection, tx, [treasury], {
        commitment: 'confirmed',
        maxRetries: 5,
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (attempt === 3) {
        console.error(`  ${label} FAILED after 3 attempts — ${msg}`);
        failed += batch.length;
      } else {
        console.error(`  ${label} attempt ${attempt} failed (${msg.slice(0, 80)}), retrying…`);
        await sleep(2000 * attempt);
      }
    }
  }

  if (signature) {
    // Record before moving on. If the process dies here, the next run
    // reads this file and skips everyone in it.
    for (const p of batch) recordSent(p.wallet, signature);
    paid += batch.length;
    console.log(`  ${label}  ${batch.length} paid  ${signature}`);
  }

  await sleep(400); // stay friendly to the RPC
}

console.log(`\n${paid} paid, ${failed} failed. Log: ${SENT_LOG}`);
if (failed) console.log('Re-run the same command — everyone already paid will be skipped.');
process.exitCode = failed ? 1 : 0;
