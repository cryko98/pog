/**
 * The snowball arena, fought by two throwaway wallets against a real API —
 * and cheated at, every way a client could try.
 *
 *   node tools/arenacheck.mjs        (needs POG_DEV_KEY=localtest on the server)
 *
 * Every line must read PASS.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getNode } from '../shared/world.js';
import { DUEL } from '../shared/duel.js';
import { FIGHT, simulate, outcome } from '../shared/fight.js';

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
const arena = getNode('station-arena');
const here = { x: arena.x + 30, y: arena.y + 10 };
const post = (path, token, body) => call(path, { method: 'POST', token, body });

console.log('--- the rules, offline ---');
{
  const s0 = 1_000_000;
  let st = simulate([{ t: s0 + 100, side: 'b', type: 'throw', kind: 'straight' }], s0, s0 + 2000);
  check('a straight ball hits a penguin standing in its way', st.b.hits === 1);
  st = simulate([{ t: s0 + 100, side: 'b', type: 'throw', kind: 'straight' }, { t: s0 + 850, side: 'a', type: 'jump' }], s0, s0 + 2000);
  check('a jump in time clears it', st.b.hits === 0);
  st = simulate([{ t: s0 + 100, side: 'b', type: 'throw', kind: 'straight' }, { t: s0 + 1300, side: 'a', type: 'jump' }], s0, s0 + 2000);
  check('a jump after it has crossed does not', st.b.hits === 1);
  st = simulate([{ t: s0 + 100, side: 'b', type: 'throw', kind: 'lob', targetX: FIGHT.startA }], s0, s0 + 2000);
  check('a lob lands on a penguin that stays put', st.b.hits === 1);
  st = simulate([{ t: s0 + 100, side: 'b', type: 'throw', kind: 'lob', targetX: FIGHT.startA }, { t: s0 + 200, side: 'a', type: 'move', dir: -1 }], s0, s0 + 2000);
  check('stepping out from under a lob dodges it', st.b.hits === 0);
  st = simulate([{ t: s0 + 100, side: 'a', type: 'jump' }, { t: s0 + 200, side: 'a', type: 'jump' }, { t: s0 + 300, side: 'a', type: 'jump' }], s0, s0 + 400);
  check('jumps have a cooldown', st.events.filter((e) => e.type === 'jump').length === 1);
  st = simulate([0, 1, 2, 3, 4].map((i) => ({ t: s0 + 100 + i * 50, side: 'a', type: 'throw', kind: 'straight' })), s0, s0 + 500);
  check('throws have a cooldown and a cap in the air', st.events.filter((e) => e.type === 'throw').length === 1);
  const ins = Array.from({ length: 60 }, (_, i) => ({ t: s0 + i * 250, side: i % 2 ? 'a' : 'b', type: ['move', 'jump', 'throw'][i % 3], dir: 1, kind: i % 2 ? 'lob' : 'straight', targetX: 500 }));
  check('the replay is deterministic whatever order the log is in', JSON.stringify(simulate(ins, s0, s0 + 20000)) === JSON.stringify(simulate([...ins].reverse(), s0, s0 + 20000)));
  check('level after the clock and overtime is a draw', outcome(simulate([], s0, s0 + 80000), s0, s0 + 80000).winner === null);
}

const probe = await grant((await signIn('Probe')).token, {});
if (probe.status === 404 || probe.status === 401) {
  console.log('skip  dev grants are off here; the match cannot be staged');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

console.log('\n--- putting up a challenge ---');
const A = await signIn('Ava' + Math.floor(Math.random() * 9000));
const B = await signIn('Bo' + Math.floor(Math.random() * 9000));
await grant(A.token, { wood: 60, fish: 10, pog: 50 }); // within a fresh wallet's pack cap, stake included
await grant(B.token, { wood: 60, fish: 10, pog: 50 });

{
  const r = await post('/api/arena/create', A.token, { kind: 'soft', stake: { wood: 500 }, ...here });
  check('staking more than you hold is refused', r.status === 409 && /do not have/.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/arena/create', A.token, { kind: 'soft', stake: {}, ...here });
  check('an empty stake is refused', r.status === 409, r.json.error);
}
{
  const r = await post('/api/arena/create', A.token, { kind: 'pog', stake: 100, ...here });
  check('real $POG stakes are refused until the pool is live', r.status === 409 && /live/.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/arena/create', A.token, { kind: 'soft', stake: { wood: 40, pog: 10 }, x: arena.x + 3000, y: arena.y });
  check('you have to be at the arena to put one up', r.status === 409 && /arena/i.test(r.json.error), r.json.error);
}

await sleep(1100);
const before = await profile(A.token);
let matchId = '';
{
  const r = await post('/api/arena/create', A.token, { kind: 'soft', stake: { wood: 40, pog: 10 }, ...here });
  check('a fair challenge goes up', r.status === 200 && !!r.json.id, r.json.error);
  matchId = r.json.id;
  const after = await profile(A.token);
  check('the stake left the host’s pack at once', after.wood === before.wood - 40 && after.pog === before.pog - 10, `wood ${before.wood}->${after.wood} pog ${before.pog}->${after.pog}`);
}
{
  const r = await post('/api/arena/create', A.token, { kind: 'soft', stake: { wood: 1 }, ...here });
  check('one match at a time', r.status === 409 && /already/.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/arena/accept', A.token, { id: matchId, ...here });
  check('you cannot take your own challenge', r.status === 409 && /yourself/.test(r.json.error), r.json.error);
}
{
  const { json } = await call('/api/arena/open');
  check('it shows on the board', json.challenges.some((c) => c.id === matchId));
}
{
  const r = await post('/api/arena/input', B.token, { id: matchId, type: 'jump' });
  check('a stranger cannot act in a match they are not in', r.status === 409, r.json.error);
}

console.log('\n--- taking it ---');
await sleep(1100);
const bBefore = await profile(B.token);
{
  const [r1, r2] = await Promise.all([
    post('/api/arena/accept', B.token, { id: matchId, ...here }),
    post('/api/arena/accept', B.token, { id: matchId, ...here }),
  ]);
  const ok = [r1, r2].filter((r) => r.status === 200).length;
  check('two racing accepts: exactly one takes it', ok === 1, `${r1.status},${r2.status}`);
  const after = await profile(B.token);
  check('the challenger’s stake is escrowed too', after.wood === bBefore.wood - 40 && after.pog === bBefore.pog - 10, `wood ${bBefore.wood}->${after.wood}`);
}

const state = async (token) => (await call(`/api/arena/state?id=${matchId}`, { token })).json.match;
let v = await state(A.token);
check('the match is live with a countdown', v.state === 'live' && v.startAt > v.serverNow, `${v.state} startAt-now=${v.startAt - v.serverNow}`);
check('the host is side a, the challenger side b', v.side === 'a' && (await state(B.token)).side === 'b');

console.log('\n--- cheating at the fight ---');
{
  const r = await post('/api/arena/input', A.token, { id: matchId, type: 'jump' });
  check('nothing counts during the countdown', r.status === 409 && /Not yet/.test(r.json.error), r.json.error);
}
await sleep(Math.max(0, v.startAt - v.serverNow + 200));
{
  const r = await post('/api/arena/input', A.token, { id: matchId, type: 'teleport', x: 900 });
  check('an invented move type is refused', r.status === 409, r.json.error);
  const r2 = await post('/api/arena/input', A.token, { id: matchId, type: 'throw', kind: 'lob', targetX: 99999 });
  check('a lob aimed off the stage is refused', r2.status === 409, r2.json.error);
  const r3 = await post('/api/arena/input', A.token, { id: matchId, type: 'move', dir: 1, x: 999, y: 50, hits: 5, t: 1 });
  check('position, hits and timestamps in a request are ignored, not applied', r3.status === 200 && r3.json.t > Date.now() - 5000, JSON.stringify(r3.json));
  const { json } = await call(`/api/arena/inputs?id=${matchId}&since=0`, { token: A.token });
  const last = json.inputs[json.inputs.length - 1];
  check('the stamped log holds only what the server allows', last && last.type === 'move' && last.dir === 1 && !('x' in last) && !('hits' in last) && last.t === r3.json.t, JSON.stringify(last));
}
{
  // a flood: more inputs in one second than a hand can make
  const rs = await Promise.all(Array.from({ length: 25 }, () => post('/api/arena/input', A.token, { id: matchId, type: 'move', dir: 0 })));
  const refused = rs.filter((r) => r.status === 409 && /Slow down/.test(r.json.error)).length;
  check('an input flood is capped', refused >= 8, `${refused} of 25 refused`);
}
{
  const r = await post('/api/arena/input', B.token, { id: matchId, type: 'throw', kind: 'straight' });
  check('B throws', r.status === 200, r.json.error);
  // A "jumps" too late: the ball has long crossed by the time this lands
  await sleep(1500);
  const r2 = await post('/api/arena/input', A.token, { id: matchId, type: 'jump' });
  check('A jumps (late)', r2.status === 200, r2.json.error);
  await sleep(300);
  const now = await state(B.token);
  check('the server scored the hit — a late jump does not undo it', now.myHits === 1 && now.theirHits === 0, `B=${now.myHits} A=${now.theirHits}`);
}

console.log('\n--- playing it out ---');
{
  // B throws a straight ball every cooldown; A stands there. First to five.
  let final = null;
  for (let i = 0; i < 12; i++) {
    await post('/api/arena/input', B.token, { id: matchId, type: 'throw', kind: 'straight' });
    await sleep(FIGHT.throwCooldownMs + 350);
    final = await state(B.token);
    if (final.state === 'done') break;
  }
  check('the match ends at five hits', final && final.state === 'done', `${final?.state} ${final?.myHits}-${final?.theirHits}`);
  check('B won', final && final.won === true && final.winner === B.wallet, final?.reason);
  const a = await profile(A.token);
  const b = await profile(B.token);
  const rake = Math.max(1, Math.round(20 * DUEL.rake));
  check('the winner holds both stakes, less the $POG rake', b.wood === bBefore.wood + 40 && b.pog === bBefore.pog + 10 - rake, `wood ${b.wood} pog ${b.pog} (expected ${bBefore.wood + 40}/${bBefore.pog + 10 - rake})`);
  check('the loser is out their stake', a.wood === before.wood - 40 && a.pog === before.pog - 10, `wood ${a.wood} pog ${a.pog}`);
  const r = await post('/api/arena/input', A.token, { id: matchId, type: 'jump' });
  check('nothing more can be done once it is over', r.status === 409, r.json.error);
  const mine = (await call('/api/arena/state', { token: A.token })).json.match;
  check('both are free to fight again', mine === null || mine.state === 'done');
}

console.log('\n--- walking away ---');
{
  const C = await signIn('Cy' + Math.floor(Math.random() * 9000));
  await grant(C.token, { fish: 10 });
  const cb = await profile(C.token);
  await sleep(1100);
  const r = await post('/api/arena/create', C.token, { kind: 'soft', stake: { fish: 5 }, ...here });
  check('a challenge with fish goes up', r.status === 200, r.json.error);
  const r2 = await post('/api/arena/cancel', C.token, {});
  const after = await profile(C.token);
  check('taking it down returns the stake', r2.status === 200 && after.fish === cb.fish, `fish ${cb.fish}->${after.fish}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
