/**
 * End-of-season snapshot: turns the Frost ledger into a distribution list.
 *
 *   node --env-file=.vercel/.env.prod tools/snapshot.mjs
 *   node --env-file=.vercel/.env.prod tools/snapshot.mjs --exclude excluded.txt
 *
 * Writes three files into `snapshots/`:
 *
 *   season-<n>.csv    wallet,name,frost,share,tokens    — the payout list
 *   season-<n>.json   the same, plus the inputs and the merkle root
 *   season-<n>.proofs.json   one proof per wallet, for a claim contract
 *
 * The merkle leaf is  sha256("<wallet>:<tokens>")  and internal nodes are
 * sha256 of the two children sorted bytewise, so a proof needs no
 * direction bits. Whatever distributor program gets used will have its own
 * leaf encoding — match it here before publishing a root, and re-run.
 *
 * Nothing in this script touches a chain or moves a token. It produces the
 * list; sending is a separate, deliberate step.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';
import { SEASON } from '../shared/season.js';
import { buildTree, leafFor, proofFor, verifyProof } from './merkle.mjs';

const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error('No Upstash credentials. Run: npx vercel env pull .vercel/.env.prod --environment=production');
  process.exit(1);
}

const redis = new Redis({ url, token });

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};

/** Wallets to leave out entirely — one address per line, # for comments. */
const excludePath = argOf('--exclude');
const excluded = new Set(
  excludePath
    ? readFileSync(excludePath, 'utf8')
        .split('\n')
        .map((l) => l.split('#')[0].trim())
        .filter(Boolean)
    : []
);

/* ------------------------------------------------------------------ */

const boardKey = `pog:frost:s${SEASON.id}`;
const poolKey = `pog:frostpool:s${SEASON.id}`;

const raw = await redis.zrange(boardKey, 0, -1, { rev: true, withScores: true });
// Upstash returns a flat [member, score, member, score, ...]
const rows = [];
for (let i = 0; i < raw.length; i += 2) {
  rows.push({ wallet: String(raw[i]), frost: Math.round(Number(raw[i + 1])) });
}

if (!rows.length) {
  console.error(`No Frost banked for season ${SEASON.id}. Nothing to snapshot.`);
  process.exit(1);
}

const names = {};
for (const r of rows) {
  const p = await redis.get(`pog:wallet:${r.wallet}`);
  names[r.wallet] = (p && p.name) || '';
}

const kept = rows.filter((r) => r.frost > 0 && !excluded.has(r.wallet) && names[r.wallet]);
const dropped = rows.length - kept.length;

// The pool counter is a running total and can drift from the sum of the
// zset if a season was ever reset by hand. The zset is the source of truth
// for a payout, so shares are computed from it and the counter is only
// reported for comparison.
const total = kept.reduce((s, r) => s + r.frost, 0);
const counter = Math.round(Number(await redis.get(poolKey)) || 0);

let assigned = 0;
const list = kept.map((r) => {
  const share = r.frost / total;
  const tokens = Math.floor(share * SEASON.budget);
  assigned += tokens;
  return { wallet: r.wallet, name: names[r.wallet], frost: r.frost, share, tokens };
});

const leaves = list.map((e) => leafFor(e.wallet, e.tokens));
const { root, layers } = buildTree(leaves);

// Never publish a root without checking every proof against it first.
const proofs = list.map((_, i) => proofFor(layers, i));
const badProof = leaves.findIndex((leaf, i) => !verifyProof(leaf, proofs[i], root));
if (badProof >= 0) {
  console.error(`Proof ${badProof} (${list[badProof].wallet}) does not verify. Refusing to write a root.`);
  process.exit(1);
}

mkdirSync('snapshots', { recursive: true });
const stem = `snapshots/season-${SEASON.id}`;

writeFileSync(
  `${stem}.csv`,
  ['wallet,name,frost,share,tokens']
    .concat(list.map((e) => `${e.wallet},"${e.name.replace(/"/g, '""')}",${e.frost},${e.share.toFixed(10)},${e.tokens}`))
    .join('\n') + '\n'
);

writeFileSync(
  `${stem}.json`,
  JSON.stringify(
    {
      season: { id: SEASON.id, name: SEASON.name, starts: SEASON.starts, ends: SEASON.ends },
      takenAt: new Date().toISOString(),
      budget: SEASON.budget,
      wallets: list.length,
      excluded: dropped,
      totalFrost: total,
      poolCounter: counter,
      tokensAssigned: assigned,
      dust: SEASON.budget - assigned,
      merkle: { leaf: 'sha256("<wallet>:<tokens>")', pairs: 'sorted', root: root?.toString('hex') ?? null },
      entries: list,
    },
    null,
    2
  ) + '\n'
);

writeFileSync(
  `${stem}.proofs.json`,
  JSON.stringify(
    Object.fromEntries(
      list.map((e, i) => [e.wallet, { tokens: e.tokens, proof: proofs[i].map((h) => h.toString('hex')) }])
    ),
    null,
    2
  ) + '\n'
);

console.log(`Season ${SEASON.id} — ${SEASON.name}`);
console.log(`  wallets       ${list.length}${dropped ? `  (${dropped} excluded or unnamed)` : ''}`);
console.log(`  total Frost   ${total.toLocaleString('en-US')}${counter !== total ? `   [pool counter says ${counter.toLocaleString('en-US')}]` : ''}`);
console.log(`  budget        ${SEASON.budget.toLocaleString('en-US')}`);
console.log(`  assigned      ${assigned.toLocaleString('en-US')}  (dust ${(SEASON.budget - assigned).toLocaleString('en-US')})`);
console.log(`  merkle root   ${root?.toString('hex')}`);
console.log(`  proofs        ${proofs.length} generated, all verified against the root`);
console.log(`\nWrote ${stem}.csv, ${stem}.json, ${stem}.proofs.json`);
console.log('\nNothing was sent. Review the CSV before any transfer.');
