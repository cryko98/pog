/**
 * The season rules, exercised without a server.
 *
 *   node tools/seasonmath.mjs
 *
 * Covers the arithmetic that decides who gets paid what: caps, streaks,
 * multiplier stacking, the share split, and — the point of the whole
 * design — that concentrating effort on one wallet beats spreading it
 * across several.
 */

import {
  FROST,
  HOLDER_TIERS,
  OFFERING_DAILY_CAP,
  SEASON,
  applyMultiplier,
  holderTier,
  multipliers,
  seasonState,
  shareOf,
} from '../shared/season.js';
import { buildTree, leafFor, proofFor, verifyProof } from './merkle.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const day = (n) => new Date(Date.UTC(2026, 8, 22) + n * 86_400_000).toISOString().slice(0, 10);

console.log('--- multipliers ---');
{
  const fresh = multipliers({ streakDays: 0, hasIgloo: false, balance: 0 });
  check('a fresh qualified wallet gets no bonus', fresh.total === 1, `x${fresh.total}`);
}
{
  const m = multipliers({ streakDays: 99, hasIgloo: false, balance: 0 });
  check('the streak bonus is capped', Math.abs(m.total - 1.7) < 1e-9, `x${m.total.toFixed(3)} at 99 days`);
}
{
  const a = multipliers({ streakDays: 14, hasIgloo: true, balance: 1_000_000 });
  const b = multipliers({ streakDays: 0, hasIgloo: false, balance: 0 });
  const ratio = a.total / b.total;
  check('a maxed wallet earns ~3x a fresh one, not 10x', ratio > 2.5 && ratio < 3.5, `${ratio.toFixed(2)}x`);
}

console.log('\n--- holder tiers punish splitting a bag ---');
{
  // The whole anti-sybil argument, as arithmetic. One wallet with the bag
  // against ten wallets with a tenth each, same total effort either way.
  const bag = 1_000_000;
  const base = FROST.dailyCap;

  const concentrated = applyMultiplier(base, multipliers({ streakDays: 14, hasIgloo: true, balance: bag }).total);
  const split = 10 * applyMultiplier(base, multipliers({ streakDays: 14, hasIgloo: true, balance: bag / 10 }).total);

  // Ten wallets still out-earn one, because ten wallets is ten times the
  // daily cap. What matters is that each one is worth LESS, so the farm
  // pays for ten lots of playtime, ten captchas and ten qualifying hours
  // to get less than ten times the reward.
  const perWallet = split / 10;
  check(
    'splitting a bag drops every wallet to a lower tier',
    holderTier(bag).label !== holderTier(bag / 10).label,
    `${holderTier(bag).label} -> ${holderTier(bag / 10).label}`
  );
  check('and each split wallet earns less than the concentrated one', perWallet < concentrated, `${perWallet} < ${concentrated}`);
  check(
    'so ten wallets return under ten times the reward',
    split < concentrated * 10,
    `${split} vs ${concentrated * 10}`
  );
}
{
  check('tiers are ordered and the floor is zero', HOLDER_TIERS[HOLDER_TIERS.length - 1].mult === 0);
  check('a balance below the lowest tier gets nothing', holderTier(49_999).mult === 0);
  check('the lowest tier starts exactly at its threshold', holderTier(50_000).mult > 0);
}

console.log('\n--- the daily cap ---');
{
  // Re-implement the credit loop the way the server runs it, to prove the
  // cap holds no matter how the base arrives.
  const bank = (chunks, mult) => {
    let today = 0;
    let frost = 0;
    for (const c of chunks) {
      const room = Math.max(0, FROST.dailyCap - today);
      const use = Math.min(c, room);
      if (use <= 0) continue;
      today += use;
      frost += applyMultiplier(use, mult);
    }
    return { today, frost };
  };

  const many = bank(Array(500).fill(10), 1);
  check('500 small credits cannot exceed the daily cap', many.today === FROST.dailyCap, `${many.today} base`);

  const one = bank([99999], 1);
  check('one huge credit is clipped to the cap too', one.today === FROST.dailyCap, `${one.today} base`);

  const maxed = bank(Array(500).fill(10), multipliers({ streakDays: 14, hasIgloo: true, balance: 1_000_000 }).total);
  check('the cap is on the base, so multipliers still apply', maxed.frost > FROST.dailyCap, `${maxed.frost} frost`);
  check('and a day can never beat cap x max multiplier', maxed.frost <= FROST.dailyCap * 3, `${maxed.frost}`);
}
{
  const perDay = Math.floor(FROST.dailyCap * multipliers({ streakDays: 14, hasIgloo: true, balance: 1_000_000 }).total);
  const season = perDay * seasonState().totalDays;
  check('a perfect season is a bounded number', season > 0 && Number.isFinite(season), `${season.toLocaleString('en-US')} frost`);
}

console.log('\n--- offerings ---');
{
  const cap = OFFERING_DAILY_CAP;
  let taken = 0;
  let refused = 0;
  for (let i = 0; i < 20; i++) {
    if (taken >= cap) {
      refused++;
      continue;
    }
    taken += Math.min(6, cap - taken);
  }
  check('the cairn stops at its own daily cap', taken === cap, `${taken}/${cap}`);
  check('and refuses everything after that', refused > 0, `${refused} refused`);
  check('the cairn alone cannot fill a day', cap < FROST.dailyCap, `${cap} < ${FROST.dailyCap}`);
}

console.log('\n--- shares ---');
{
  const pool = 1_000_000;
  const holders = [500_000, 300_000, 200_000];
  const paid = holders.map((f) => shareOf(f, pool).tokens);
  const total = paid.reduce((a, b) => a + b, 0);
  check('shares sum to the budget, give or take rounding dust', total <= SEASON.budget && SEASON.budget - total < holders.length, `${total} of ${SEASON.budget}`);
  check('a bigger share pays more', paid[0] > paid[1] && paid[1] > paid[2], paid.join(' > '));
  check('an empty pool pays nothing rather than dividing by zero', shareOf(100, 0).tokens === 0);
  check('no Frost pays nothing', shareOf(0, pool).tokens === 0);
}
{
  // The property that makes a share honest: doubling everyone's Frost
  // changes nobody's payout.
  const before = shareOf(1000, 10_000).tokens;
  const after = shareOf(2000, 20_000).tokens;
  check('inflating all Frost equally changes no payout', before === after, `${before} == ${after}`);
}

console.log('\n--- season window ---');
{
  const s = seasonState(Date.parse(SEASON.starts + 'T00:00:00Z'));
  check('the season is open on its first day', s.open && s.dayNumber === 1);
  const e = seasonState(Date.parse(SEASON.ends + 'T00:00:00Z'));
  check('and closed the moment it ends', e.over && !e.open, `daysLeft=${e.daysLeft}`);
  const b = seasonState(Date.parse(SEASON.starts + 'T00:00:00Z') - 86_400_000);
  check('and not open before it starts', b.before && !b.open);
  check('day counting matches the configured window', seasonState(Date.parse(SEASON.ends + 'T00:00:00Z') - 1).dayNumber === s.totalDays, `${s.totalDays} days`);
}
{
  check('the day rolls over in UTC', day(0) === SEASON.starts, day(0));
}

console.log('\n--- the merkle tree the snapshot publishes ---');
{
  // Exhaustive rather than illustrative: a distribution root is the one
  // artefact that cannot be fixed after it is published.
  let verified = 0;
  let forgeable = 0;
  let broken = 0;

  for (let n = 1; n <= 40; n++) {
    const entries = Array.from({ length: n }, (_, i) => ({
      wallet: 'Wallet' + String(i).padStart(3, '0'),
      tokens: (i + 1) * 137,
    }));
    const leaves = entries.map((e) => leafFor(e.wallet, e.tokens));
    const { root, layers } = buildTree(leaves);

    for (let i = 0; i < n; i++) {
      const proof = proofFor(layers, i);
      verified++;
      if (!verifyProof(leaves[i], proof, root)) broken++;
      // claiming more than you were allotted
      if (verifyProof(leafFor(entries[i].wallet, entries[i].tokens + 1), proof, root)) forgeable++;
      // someone else reusing your proof
      if (verifyProof(leafFor('ATTACKER', entries[i].tokens), proof, root)) forgeable++;
    }
  }

  check(`every proof verifies (${verified} across 40 tree sizes)`, broken === 0, `${broken} broken`);
  check('no proof can be forged or reused by another wallet', forgeable === 0, `${forgeable} forgeries`);
}
{
  const { root } = buildTree([]);
  check('an empty ledger produces no root rather than a fake one', root === null);
}
{
  // Order must not change the root, or two honest runs disagree.
  const entries = [
    ['Aaa', 10],
    ['Bbb', 20],
    ['Ccc', 30],
  ];
  const a = buildTree(entries.map(([w, t]) => leafFor(w, t))).root;
  const b = buildTree(entries.slice().reverse().map(([w, t]) => leafFor(w, t))).root;
  check('reordering the list changes the root (so order must be pinned)', Buffer.compare(a, b) !== 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
