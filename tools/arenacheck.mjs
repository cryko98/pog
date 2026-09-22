/**
 * The snowball arena, played by two throwaway wallets against a real API —
 * and cheated at, every way a client could try.
 *
 *   node tools/arenacheck.mjs        (needs POG_DEV_KEY=localtest on the server)
 *
 * Every line must read PASS.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getNode } from '../shared/world.js';
import { DUEL, LANES, commitHash, resolveVolley, throwLands } from '../shared/duel.js';

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
check('same lane, standing: hit', throwLands('left', 'low', 'left', false));
check('same lane, jumping over a low ball: miss', !throwLands('left', 'low', 'left', true));
check('same lane, jumping into a high ball: hit', throwLands('left', 'high', 'left', true));
check('different lane: miss', !throwLands('left', 'high', 'right', false));
check('a side that sat out throws nothing and stands in the centre', JSON.stringify(resolveVolley(null, { throwLane: 'centre', throwHeight: 'low', dodgeLane: 'left', jump: false })) === '{"aHits":0,"bHits":1}');

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
  await sleep(1100);
  const r = await post('/api/arena/commit', B.token, { id: matchId, hash: 'a'.repeat(64) });
  check('a stranger cannot throw in a match they are not in', r.status === 409, r.json.error);
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
{
  const v = await state(A.token);
  check('the match is live, volley 1, sealing', v.state === 'live' && v.volley === 0 && v.phase === 'commit', `${v.state}/${v.phase}`);
  check('the host cannot see the challenger’s choice', v.them && v.them.choice === undefined);
}

console.log('\n--- cheating at a volley ---');
const choiceA = { throwLane: 'left', throwHeight: 'low', dodgeLane: 'right', jump: false };
const choiceB = { throwLane: 'right', throwHeight: 'high', dodgeLane: 'left', jump: true };
const nonceA = 'nonce-a-0001';
const nonceB = 'nonce-b-0001';
{
  const r = await post('/api/arena/reveal', A.token, { id: matchId, choice: choiceA, nonce: nonceA });
  check('revealing before sealing is refused', r.status === 409 && /did not throw/.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/arena/commit', A.token, { id: matchId, hash: 'not-a-hash' });
  check('a malformed commitment is refused', r.status === 409, r.json.error);
}
{
  const r = await post('/api/arena/commit', A.token, { id: matchId, hash: await commitHash(choiceA, nonceA) });
  check('A seals', r.status === 200, r.json.error);
  const r2 = await post('/api/arena/commit', A.token, { id: matchId, hash: await commitHash(choiceB, nonceA) });
  check('A cannot seal twice', r2.status === 409, r2.json.error);
}
{
  const r = await post('/api/arena/reveal', A.token, { id: matchId, choice: choiceA, nonce: nonceA });
  check('A cannot open before B has sealed', r.status === 409 && /Wait/.test(r.json.error), r.json.error);
}
{
  const r = await post('/api/arena/commit', B.token, { id: matchId, hash: await commitHash(choiceB, nonceB) });
  check('B seals; the volley moves to the reveal', r.status === 200 && r.json.match.phase === 'reveal', r.json.error);
}
{
  const other = { ...choiceA, throwLane: 'right' };
  const r = await post('/api/arena/reveal', A.token, { id: matchId, choice: other, nonce: nonceA });
  check('changing the throw after sealing is refused', r.status === 409 && /sealed/.test(r.json.error), r.json.error);
  const r2 = await post('/api/arena/reveal', A.token, { id: matchId, choice: choiceA, nonce: 'wrong-nonce' });
  check('a wrong nonce is refused', r2.status === 409 && /sealed/.test(r2.json.error), r2.json.error);
  const r3 = await post('/api/arena/reveal', A.token, { id: matchId, choice: { ...choiceA, throwLane: 'up' }, nonce: nonceA });
  check('an impossible lane is refused', r3.status === 409, r3.json.error);
}
{
  const r = await post('/api/arena/reveal', A.token, { id: matchId, choice: choiceA, nonce: nonceA });
  check('A opens the real choice', r.status === 200, r.json.error);
  const r2 = await post('/api/arena/reveal', B.token, { id: matchId, choice: choiceB, nonce: nonceB });
  check('B opens; the volley resolves', r2.status === 200 && r2.json.match.history.length === 1, r2.json.error);
  const v = r2.json.match;
  // A threw left/low; B stood left and jumped -> miss. B threw right/high; A stood right, no jump -> hit.
  check('the server scored it: B hit, A missed', v.me.hits === 1 && v.them.hits === 0, `B=${v.me.hits} A=${v.them.hits}`);
  check('both choices are public once resolved', v.history[0].theirs?.throwLane === 'left' && v.history[0].mine?.throwLane === 'right');
}

console.log('\n--- playing it out ---');
// B keeps throwing high into A's lane while A stands still: B wins the rest
async function volley(a, b) {
  const na = 'n' + Math.random().toString(36).slice(2, 12);
  const nb = 'n' + Math.random().toString(36).slice(2, 12);
  const ca = await post('/api/arena/commit', A.token, { id: matchId, hash: await commitHash(a, na) });
  const cb = await post('/api/arena/commit', B.token, { id: matchId, hash: await commitHash(b, nb) });
  if (ca.status !== 200 || cb.status !== 200) return { error: ca.json.error || cb.json.error };
  await post('/api/arena/reveal', A.token, { id: matchId, choice: a, nonce: na });
  const r = await post('/api/arena/reveal', B.token, { id: matchId, choice: b, nonce: nb });
  return r.json.match || { error: r.json.error };
}
let v = null;
for (let i = 0; i < DUEL.volleys + 2; i++) {
  v = await volley(
    { throwLane: LANES[i % 3], throwHeight: 'low', dodgeLane: 'centre', jump: false },
    { throwLane: 'centre', throwHeight: 'high', dodgeLane: LANES[(i + 1) % 3], jump: false }
  );
  if (v.error || v.state === 'done') break;
}
check('the match ends after the volleys', v && v.state === 'done', v?.error || `${v?.state} after ${v?.history?.length}`);
check('B won on hits', v && v.won === true && v.winner === B.wallet, `winner ${v?.winner?.slice(0, 6)} reason ${v?.reason}`);
{
  const a = await profile(A.token);
  const b = await profile(B.token);
  const rake = Math.max(1, Math.round(20 * DUEL.rake));
  check('the winner holds both stakes, less the $POG rake', b.wood === bBefore.wood + 40 && b.pog === bBefore.pog + 10 - rake, `wood ${b.wood} pog ${b.pog} (expected ${bBefore.wood + 40}/${bBefore.pog + 10 - rake})`);
  check('the loser is out their stake', a.wood === before.wood - 40 && a.pog === before.pog - 10, `wood ${a.wood} pog ${a.pog}`);
  const r = await post('/api/arena/commit', A.token, { id: matchId, hash: 'b'.repeat(64) });
  check('nothing more can be thrown once it is over', r.status === 409, r.json.error);
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
