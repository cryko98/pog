/**
 * The daily airdrop: the maths offline, and a day closed against a real
 * API with two wallets that banked Frost at the cairn.
 *
 *   node tools/airdropcheck.mjs   (needs POG_DEV_KEY=localtest and
 *                                  POG_GATE_MINUTES=1 POG_GATE_MINUTES_TODAY=1 on the server)
 *
 * Every line must read PASS.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getNode } from '../shared/world.js';
import { AIRDROP, dailyBudget, remainingAfter, splitDay } from '../shared/airdrop.js';
import { dayOf } from '../shared/season.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const DEV = process.env.DEV_KEY || 'localtest';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 100) };
  }
  return { status: res.status, json };
}

async function signIn(name) {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const { json: n } = await call(`/api/auth/nonce?wallet=${wallet}`);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey));
  const { json: auth } = await call('/api/auth/verify', { method: 'POST', body: { wallet, signature } });
  await call('/api/profile/set', { method: 'POST', token: auth.token, body: { name, color: '#38bdf8' } });
  return { wallet, token: auth.token };
}

const grant = (token, gift) => call('/api/dev/grant', { method: 'POST', token, body: { ...gift, devKey: DEV } });
const post = (path, token, body) => call(path, { method: 'POST', token, body });
const cairn = getNode('station-cairn');
const atCairn = { x: cairn.x + 20, y: cairn.y + 10 };

console.log('--- the maths, offline ---');
{
  check('day one pays 0.2% of the wallet', dailyBudget(AIRDROP.supply) === Math.floor(AIRDROP.supply * AIRDROP.dailyRate), String(dailyBudget(AIRDROP.supply)));
  check('the budget never exceeds what is left', dailyBudget(3) === 3 && dailyBudget(0) === 0);
  check('the floor holds while there is that much', dailyBudget(1_000_000) === AIRDROP.dailyFloor);
  check('the cap holds on a topped-up wallet', dailyBudget(1_000_000_000) === AIRDROP.dailyCap);
  check('about half is paid in the first year', remainingAfter(365) > AIRDROP.supply * 0.44 && remainingAfter(365) < AIRDROP.supply * 0.52, String(remainingAfter(365)));
  let left = AIRDROP.supply;
  let days = 0;
  while (left > 0 && days < 100_000) {
    left -= dailyBudget(left);
    days++;
  }
  check('the wallet lasts years, not months', days > 1500, `${days} days`);
  const rows = [
    { wallet: 'a', frost: 290, iglooValue: 40 },
    { wallet: 'b', frost: 60, iglooValue: 0 },
    { wallet: 'c', frost: 60, iglooValue: 10 },
    { wallet: 'd', frost: 0, iglooValue: 99 },
  ];
  const split = splitDay(100_000, rows);
  const paid = split.reduce((s, r) => s + r.total, 0);
  check('a split never pays more than the budget', paid <= 100_000 && paid > 99_000, String(paid));
  check('the players slice is by Frost', split[0].players > split[1].players * 4.7 && split[0].players < split[1].players * 4.9, `${split[0].players} vs ${split[1].players}`);
  check('the igloo slice is by igloo value, among active wallets only', split[0].igloo === 16_000 && split[2].igloo === 4_000 && !split.some((r) => r.wallet === 'd'), JSON.stringify(split.map((r) => [r.wallet, r.igloo])));
  const noIgloos = splitDay(1000, [{ wallet: 'a', frost: 10, iglooValue: 0 }, { wallet: 'b', frost: 30, iglooValue: 0 }]);
  check('with no igloo in play, the whole budget goes to the players', noIgloos.reduce((s, r) => s + r.total, 0) === 1000, JSON.stringify(noIgloos));
  check('a day with nobody pays nobody', splitDay(1000, []).length === 0);
}

console.log('\n--- a day, closed against the API ---');
const a = await signIn('Drop' + Math.floor(Math.random() * 9000 + 1000));
const b = await signIn('Flake' + Math.floor(Math.random() * 9000 + 1000));
for (const w of [a, b]) {
  await grant(w.token, { wood: 200 });
  await call('/api/online/beat', { method: 'POST', token: w.token, body: { id: w.wallet } });
}
await sleep(200);
{
  // Frost at the cairn: a offers twice, b once — a should take twice b's players slice
  let r = await post('/api/season/offer', a.token, { id: 'wood', ...atCairn });
  check('an offering banks Frost once qualified', r.status === 200 && r.json.frost > 0, JSON.stringify(r.json).slice(0, 120));
  await sleep(1100);
  r = await post('/api/season/offer', a.token, { id: 'wood', ...atCairn });
  check('and again', r.status === 200 && r.json.frost > 0, r.json.error);
  await sleep(1100);
  r = await post('/api/season/offer', b.token, { id: 'wood', ...atCairn });
  check('the second wallet banks Frost too', r.status === 200 && r.json.frost > 0, r.json.error);
}
const today = dayOf();
let sa;
{
  const st = await call('/api/season/status', { token: a.token });
  sa = st.json;
  check('the status carries the airdrop view', st.status === 200 && sa.airdrop && typeof sa.airdrop.todayBudget === 'number', JSON.stringify(sa.airdrop).slice(0, 120));
  check('today is being indexed', sa.airdrop.todayPool >= sa.bankedToday && sa.bankedToday > 0, `banked ${sa.bankedToday} pool ${sa.airdrop.todayPool}`);
  check('nothing is owed before the day closes', sa.airdrop.owed === 0);
  check('the estimate is the players slice by share', sa.airdrop.todayEstimate === Math.floor((sa.airdrop.todayBudget * AIRDROP.playersShare * sa.bankedToday) / sa.airdrop.todayPool), String(sa.airdrop.todayEstimate));
}
{
  const r = await call('/api/dev/closeday', { method: 'POST', body: { day: today, devKey: DEV } });
  check('the day closes', r.status === 200 && r.json.record && r.json.record.day === today, JSON.stringify(r.json).slice(0, 160));
  const rec = r.json.record;
  check('the budget is 0.2% of the ledger', rec.budget === dailyBudget(rec.remaining), `${rec.budget} of ${rec.remaining}`);
  check('the record counts the two wallets', rec.wallets >= 2 && rec.frostPool >= sa.airdrop.todayPool, JSON.stringify(rec));
  check('what was paid is at most the budget', rec.paid <= rec.budget && rec.paid > 0, `${rec.paid} / ${rec.budget}`);
  // the dev close recomputes from scratch on purpose (so this can run twice a day);
  // the same day, the same Frost, must come out the same
  const twice = await call('/api/dev/closeday', { method: 'POST', body: { day: today, devKey: DEV } });
  // (the ledger moved by the first close, so the budget is a touch smaller; the split's shape must not change)
  check('closing the same day again computes the same split', twice.json.record?.wallets === rec.wallets && twice.json.record?.frostPool === rec.frostPool && twice.json.record?.paid <= twice.json.record?.budget, JSON.stringify(twice.json.record));
}
{
  const [sa2, sb2] = await Promise.all([call('/api/season/status', { token: a.token }), call('/api/season/status', { token: b.token })]);
  const oa = sa2.json.airdrop.owed;
  const ob = sb2.json.airdrop.owed;
  check('both wallets are now owed their share', oa > 0 && ob > 0, `a ${oa} b ${ob}`);
  check('twice the Frost is about twice the share', oa > ob * 1.9 && oa < ob * 2.1, `a ${oa} b ${ob}`);
  const share = sa2.json.airdrop.yesterday;
  // closed "today" by force, so the panel's "yesterday" is not this day; the day share is on the record instead
  check('without a key the amount stays owed, not lost', sa2.json.airdrop.automatic === false && sa2.json.justPaid === null, String(sa2.json.airdrop.automatic) + ' ' + JSON.stringify(share));
  const c = await post('/api/season/collect', a.token, {});
  check('collecting without a key sends nothing and keeps it owed', c.status === 200 && c.json.paid === 0 && c.json.pending === oa, JSON.stringify(c.json));
  const days = await call('/api/season/days');
  check('the closed day is public', days.status === 200 && days.json.days.some((d) => d.day === today));
}
{
  const r = await call('/api/season/closeday', { method: 'POST', token: a.token, body: { day: today } });
  check('there is no public endpoint that closes a day', r.status === 404, String(r.status));
  const r2 = await call('/api/cron/daily');
  check('the cron refuses without its secret', r2.status === 401, String(r2.status));
  const r3 = await call('/api/season/owe', { method: 'POST', token: a.token, body: { amount: 1000 } });
  check('there is no endpoint that credits an amount owed', r3.status === 404, String(r3.status));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
