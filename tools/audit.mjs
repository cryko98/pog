/**
 * Reads the season ledger and flags what does not look like a person.
 *
 *   node --env-file=.vercel/.env.prod tools/audit.mjs
 *   node --env-file=.vercel/.env.prod tools/audit.mjs --csv > flags.csv
 *
 * None of these flags is proof of anything, and the script deliberately
 * cannot ban or delete — it prints a list for a human to look at before a
 * snapshot is taken. The output feeds `tools/snapshot.mjs --exclude`.
 *
 * The genuinely useful signal here is the CLUSTER check: sybil farms are
 * cheap to run but expensive to individualise, so their wallets tend to
 * be created within minutes of each other and score near-identically.
 */

import { Redis } from '@upstash/redis';
import { FROST, GATE, SEASON, STREAK, multipliers, seasonState } from '../shared/season.js';

const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error('No Upstash credentials. Run: npx vercel env pull .vercel/.env.prod --environment=production');
  process.exit(1);
}

const redis = new Redis({ url, token });
const asCsv = process.argv.includes('--csv');

const raw = await redis.zrange(`pog:frost:s${SEASON.id}`, 0, -1, { rev: true, withScores: true });
const wallets = [];
for (let i = 0; i < raw.length; i += 2) wallets.push({ wallet: String(raw[i]), frost: Math.round(Number(raw[i + 1])) });

if (!wallets.length) {
  console.error(`No Frost banked for season ${SEASON.id}.`);
  process.exit(0);
}

const profiles = [];
for (const w of wallets) {
  const p = await redis.get(`pog:wallet:${w.wallet}`);
  if (p) profiles.push({ ...w, ...p });
}

const flags = new Map(); // wallet -> Set of reasons
const flag = (wallet, reason) => {
  if (!flags.has(wallet)) flags.set(wallet, new Set());
  flags.get(wallet).add(reason);
};

/* --- per-wallet checks ------------------------------------------- */

// The most Frost the rules can produce in one day, for the best possible
// wallet. Anything past `days elapsed x this` is not suspicious, it is
// impossible — so it is worth separating from the softer signals below.
const BEST_DAY = Math.floor(
  FROST.dailyCap * multipliers({ streakDays: STREAK.capDays, hasIgloo: true, balance: Infinity }).total
);
const daysElapsed = Math.max(1, seasonState().dayNumber);

/**
 * A generous ceiling on Frost per minute played. Note this is deliberately
 * NOT derived from playtime-to-days: someone playing 30 minutes a day for
 * three weeks legitimately banks far more than their total minutes would
 * suggest, and an earlier version of this check flagged exactly those
 * players. This only catches a wallet earning faster than the game pays.
 */
const FROST_PER_MINUTE = 15;

for (const p of profiles) {
  const minutes = p.playMinutes || 0;

  const hardMax = daysElapsed * BEST_DAY;
  if (p.frost > hardMax) flag(p.wallet, `impossible(${p.frost}>${hardMax})`);
  else if (minutes > 0 && p.frost > minutes * FROST_PER_MINUTE) {
    flag(p.wallet, `high-yield(${(p.frost / minutes).toFixed(1)}/min)`);
  }

  // Qualified but barely present: the gate is a floor, not a signal of life.
  if (p.frost > 0 && minutes < GATE.minutes) flag(p.wallet, `frost-below-gate(${minutes}m)`);

  // Nothing but the cairn: a wallet that never quested, never built, and
  // only ever dumped resources is the cheapest farm shape to run.
  if (p.frost > FROST.dailyCap && !p.streak && !p.iglooFrostSeason) {
    flag(p.wallet, 'offerings-only');
  }

  // Resources far beyond what the hold cap should have allowed.
  const holdCap = 120 + minutes * 90;
  const held = (p.wood || 0) + (p.ice || 0) + (p.fish || 0);
  if (held > holdCap * 1.5) flag(p.wallet, `stock-over-cap(${held}>${holdCap})`);

  // A test account that slipped through.
  if (/^(cheat|loop|quest|season|prodcheck|farm)\d*$|^hacker$/i.test(p.name || '')) {
    flag(p.wallet, 'test-account');
  }
}

/* --- cluster check ------------------------------------------------ */

/**
 * Wallets created in the same few minutes AND landing on near-identical
 * Frost. Either one alone is unremarkable; together they are the signature
 * of a farm, because real players neither sign up in lockstep nor converge
 * on the same score.
 */
const CLUSTER_WINDOW_MS = 15 * 60 * 1000;
const CLUSTER_FROST_TOLERANCE = 0.05;

const byTime = profiles.filter((p) => p.createdAt).sort((a, b) => a.createdAt - b.createdAt);
for (let i = 0; i < byTime.length; i++) {
  const peers = [];
  for (let j = i + 1; j < byTime.length; j++) {
    if (byTime[j].createdAt - byTime[i].createdAt > CLUSTER_WINDOW_MS) break;
    const a = byTime[i].frost;
    const b = byTime[j].frost;
    const near = a === b || (a > 0 && Math.abs(a - b) / Math.max(a, b) <= CLUSTER_FROST_TOLERANCE);
    if (near) peers.push(byTime[j]);
  }
  if (peers.length >= 2) {
    for (const p of [byTime[i], ...peers]) flag(p.wallet, `cluster(${peers.length + 1} wallets)`);
  }
}

/* --- report ------------------------------------------------------- */

const rows = profiles
  .filter((p) => flags.has(p.wallet))
  .sort((a, b) => b.frost - a.frost)
  .map((p) => ({
    wallet: p.wallet,
    name: p.name || '',
    frost: p.frost,
    minutes: p.playMinutes || 0,
    streak: p.frostStreak || 0,
    reasons: [...flags.get(p.wallet)].join(' '),
  }));

if (asCsv) {
  console.log('wallet,name,frost,minutes,streak,reasons');
  for (const r of rows) console.log(`${r.wallet},"${r.name}",${r.frost},${r.minutes},${r.streak},"${r.reasons}"`);
} else {
  const totalFrost = profiles.reduce((s, p) => s + p.frost, 0);
  const flaggedFrost = rows.reduce((s, r) => s + r.frost, 0);
  console.log(`Season ${SEASON.id} — ${profiles.length} wallets with Frost, ${rows.length} flagged\n`);
  for (const r of rows) {
    console.log(
      `  ${r.wallet.slice(0, 8)}…${r.wallet.slice(-4)}  ${String(r.frost).padStart(7)} frost  ` +
        `${String(r.minutes).padStart(5)}m  ${(r.name || '—').padEnd(16)}  ${r.reasons}`
    );
  }
  if (!rows.length) console.log('  nothing looks off.');
  console.log(
    `\n${flaggedFrost.toLocaleString('en-US')} of ${totalFrost.toLocaleString('en-US')} Frost is flagged ` +
      `(${totalFrost ? ((flaggedFrost / totalFrost) * 100).toFixed(1) : '0'}%).`
  );
  console.log('\nThese are hints, not verdicts. Look at them before excluding anyone.');
}
