/**
 * The bear caves, run by a throwaway wallet against a real API — and
 * cheated at, every way a client could try.
 *
 *   node tools/cavecheck.mjs        (needs POG_DEV_KEY=localtest on the server)
 *
 * Every line must read PASS.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getNode } from '../shared/world.js';
import { CAVE, simulateRun, seedOf } from '../shared/dungeon.js';

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
const profile = async (token) => (await call('/api/game/state', { token })).json.profile;
const cave = getNode('station-cave');
const here = { x: cave.x + 30, y: cave.y + 10 };
const post = (path, token, body) => call(path, { method: 'POST', token, body });
const state = (token, id) => call('/api/dungeon/state' + (id ? '?id=' + id : ''), { token });

console.log('--- the rules, offline ---');
{
  const s0 = 1_000_000;
  const seed = seedOf('offline');
  const idle = simulateRun([], seed, s0, s0 + 60_000);
  check('a player who does nothing dies', idle.over?.why === 'dead', `at ${idle.over ? Math.round((idle.over.t - s0) / 1000) : '?'}s`);
  const ins = [];
  for (let t = 200; t < 180_000; t += 700) ins.push({ t: s0 + t, type: 'throw' });
  for (let t = 500; t < 180_000; t += 950) ins.push({ t: s0 + t, type: 'jump' });
  ins.sort((a, b) => a.t - b.t).forEach((i, k) => (i.seq = k + 1));
  const busy = simulateRun(ins, seed, s0, s0 + CAVE.durationMs + 1000);
  check('a spam thrower does not survive the whole run', busy.over?.why === 'dead', `died at ${busy.over ? Math.round((busy.over.t - s0) / 1000) : '?'}s with ${busy.coins} P coins`);
  check('the run is deterministic whatever order the log arrives in', JSON.stringify(simulateRun([...ins].reverse(), seed, s0, s0 + 60_000)) === JSON.stringify(simulateRun(ins, seed, s0, s0 + 60_000)));
  const early = simulateRun([{ t: s0 + 300, type: 'leave', seq: 1 }], seed, s0, s0 + 5000);
  check('leaving before any bear is close is allowed', early.over?.why === 'left' && early.coins === 0);
  const late = simulateRun([{ t: s0 + 7_000, type: 'leave', seq: 1 }], seed, s0, s0 + 7_400);
  check('leaving with a bear on you is refused', late.events.some((e) => e.type === 'nope') && late.over?.why !== 'left');
  const forged = simulateRun([{ t: s0 + 100, type: 'kill', seq: 1 }, { t: s0 + 200, type: 'coins', coins: 999, seq: 2 }], seed, s0, s0 + 1000);
  check('made-up input types do nothing', forged.coins === 0 && forged.kills === 0);
}

console.log('\n--- going in ---');
const me = await signIn('Cave' + Math.floor(Math.random() * 9000 + 1000));
await grant(me.token, { wood: 25, fish: 4, pog: 30 });
{
  const r = await post('/api/dungeon/enter', me.token, { x: cave.x + 3000, y: cave.y });
  check('entering from across the map is refused', r.status === 409 && /cave mouth/i.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/dungeon/enter', me.token, {});
  check('entering with no position is refused', r.status === 409, r.json.error);
}
let run;
{
  const r = await post('/api/dungeon/enter', me.token, here);
  check('entering at the cave mouth starts a run', r.status === 200 && r.json.run?.id, JSON.stringify(r.json).slice(0, 120));
  run = r.json.run;
}
{
  const r = await post('/api/dungeon/enter', me.token, here);
  check('entering again returns the same run, not a second one', r.status === 200 && r.json.run?.id === run.id);
}
{
  const other = await signIn('Peek' + Math.floor(Math.random() * 9000 + 1000));
  const r = await post('/api/dungeon/input', other.token, { id: run.id, type: 'throw' });
  check("another wallet cannot play in someone else's run", r.status === 409, r.json.error);
  const s = await state(other.token, run.id);
  check("another wallet cannot read someone else's run", s.json.run === null);
}
{
  const r = await post('/api/dungeon/input', me.token, { id: run.id, type: 'throw' });
  check('inputs before the count-in ends are refused', r.status === 409 && /Not yet/.test(r.json.error), r.json.error);
}
await sleep(Math.max(0, run.startAt - Date.now()) + 100);
{
  const r = await post('/api/dungeon/input', me.token, { id: run.id, type: 'kill', coins: 500 });
  check('an invented input type is refused', r.status === 409, r.json.error);
  const r2 = await post('/api/dungeon/input', me.token, { id: run.id, type: 'move', dir: 7 });
  check('a move with a bogus direction is refused', r2.status === 409, r2.json.error);
}
{
  const results = await Promise.all(Array.from({ length: 40 }, () => post('/api/dungeon/input', me.token, { id: run.id, type: 'throw' })));
  const ok = results.filter((r) => r.status === 200).length;
  check('a burst of 40 inputs in one second is throttled', ok <= CAVE.inputsPerSec + 1, `${ok} accepted`);
}
{
  const r = await state(me.token, run.id);
  check('the run view carries no score for the client to edit', r.status === 200 && r.json.run && !('coins' in r.json.run) && !('kills' in r.json.run));
}

console.log('\n--- walking out ---');
{
  // stand still: the first bear arrives after ~1.5 s + walk; leave before it is close
  await sleep(1100); // the burst above used up this second's allowance
  const r = await post('/api/dungeon/input', me.token, { id: run.id, type: 'leave' });
  check('leaving is accepted', r.status === 200, JSON.stringify(r.json));
  await sleep(300);
  const s = await state(me.token, run.id);
  check('the run settles as left', s.json.run?.settled?.why === 'left', JSON.stringify(s.json.run?.settled));
  const p = await profile(me.token);
  check('the pack is intact after walking out', p.wood === 25 && p.fish === 4 && p.pog === 30, `wood=${p.wood} fish=${p.fish} pog=${p.pog}`);
  const again = await state(me.token, run.id);
  check('reading it again does not settle twice', again.json.run?.settled?.at === s.json.run?.settled?.at);
}
{
  const r = await post('/api/dungeon/enter', me.token, here);
  check('a new run right after is on cooldown', r.status === 409 && /breath/i.test(r.json.error), r.json.error);
}

console.log('\n--- dying ---');
const dead = await signIn('Bait' + Math.floor(Math.random() * 9000 + 1000));
await grant(dead.token, { wood: 12, ice: 3, fish: 2, pog: 9 });
// something in the store first, which must survive
{
  const r = await post('/api/dungeon/enter', dead.token, here);
  check('the second wallet goes in', r.status === 200, JSON.stringify(r.json).slice(0, 100));
  run = r.json.run;
}
{
  // the client says nothing: the bears do the rest; the offline sim says ~12 s
  const before = await profile(dead.token);
  check('the bait carries a pack', before.wood === 12 && before.pog === 9);
  const deadline = Date.now() + 40_000;
  let settled = null;
  while (Date.now() < deadline) {
    await sleep(1500);
    const s = await state(dead.token, run.id);
    if (s.json.run?.settled) {
      settled = s.json.run.settled;
      break;
    }
  }
  check('standing still gets you eaten', settled?.why === 'dead', JSON.stringify(settled));
  const after = await profile(dead.token);
  check('the pack is gone', after.wood === 0 && after.ice === 0 && after.fish === 0 && after.pog === 0 && Object.keys(after.items).length === 0, JSON.stringify({ wood: after.wood, ice: after.ice, fish: after.fish, pog: after.pog, items: after.items }));
  check('frost is untouched by the caves', (after.frost ?? 0) === (before.frost ?? 0));
  check('the record says what was lost', settled?.lost?.wood === 12 && settled?.lost?.pog === 9, JSON.stringify(settled?.lost));
  const r = await post('/api/dungeon/input', dead.token, { id: run.id, type: 'leave' });
  check('a dead run takes no more input', r.status === 409, r.json.error);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
