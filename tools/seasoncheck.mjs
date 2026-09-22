/**
 * The season, end to end against a real server — earning and refusing.
 *
 *   POG_GATE_MINUTES=1 POG_GATE_MINUTES_TODAY=1 npm run dev
 *   BASE=http://localhost:5173 node tools/seasoncheck.mjs
 *
 * The playtime gate is an hour in production, which a test cannot sit
 * through, so the server is started with it lowered. Everything else —
 * the caps, the position check, the ledger, the board — runs exactly as
 * it does in production.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { GATHER, PLAYER, WORLD, getNodes } from '../shared/world.js';
import { OFFERINGS, OFFERING_DAILY_CAP } from '../shared/season.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const BYPASS = process.env.BYPASS;

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
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(BYPASS ? { 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'false' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 140) };
  }
  return { status: res.status, json };
}

/* --- sign in ------------------------------------------------------- */

const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const { json: n } = await call(`/api/auth/nonce?wallet=${wallet}`);
const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey));
const { json: auth } = await call('/api/auth/verify', { method: 'POST', body: { wallet, signature: sig } });
const token = auth.token;
const clientId = 'seasoncheck-' + Math.random().toString(36).slice(2, 8);
const named = await call('/api/profile/set', {
  method: 'POST',
  token,
  body: { name: 'Season' + Math.floor(Math.random() * 9000 + 1000), color: '#38bdf8' },
});
if (named.status !== 200) {
  console.log('FAIL  could not take a username —', JSON.stringify(named.json));
  process.exit(1);
}

const cairn = getNodes().find((x) => x.id === 'station-cairn');

console.log('--- config ---');
{
  const r = await call('/api/season/config');
  check('the season config is public', r.status === 200 && r.json.season?.id > 0);
  check('it says which optional gates are live', typeof r.json.gates?.chain === 'boolean', JSON.stringify(r.json.gates));
  check('the cairn exists in the world', !!cairn, cairn && `${Math.round(cairn.x)},${Math.round(cairn.y)}`);
}

console.log('\n--- no session, no ledger ---');
{
  const r = await call('/api/season/status');
  check('reading your Frost needs a session', r.status === 401);
}
{
  const r = await call('/api/season/offer', { method: 'POST', body: { id: 'wood', x: cairn.x, y: cairn.y } });
  check('offering needs a session', r.status === 401);
}
{
  // The design claim worth testing: no endpoint hands out Frost.
  for (const path of ['credit', 'grant', 'award', 'frost', 'add']) {
    const r = await call(`/api/season/${path}`, { method: 'POST', token, body: { amount: 999999 } });
    if (r.status !== 404) check(`there is no /season/${path} endpoint`, false, `got ${r.status}`);
  }
  check('there is no endpoint that credits Frost', true);
}

console.log('\n--- the gate ---');
{
  const r = await call('/api/season/status', { token });
  check('a brand-new wallet has no Frost', r.json.frost === 0, `frost=${r.json.frost}`);
  check('and is not eligible yet', r.json.gate.ok === false, r.json.gate.items.filter((i) => !i.done).map((i) => i.id).join(','));
  check(
    'the checklist says exactly what is missing',
    r.json.gate.items.every((i) => typeof i.label === 'string' && i.label.length > 0)
  );
}
{
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: 'wood', x: cairn.x, y: cairn.y } });
  check('an unqualified wallet cannot use the cairn', r.status === 409, r.json.error);
}

console.log('\n--- qualifying ---');
{
  await call('/api/online/beat', { method: 'POST', token, body: { id: clientId } });
  const r = await call('/api/season/status', { token });
  check('a heartbeat credits a minute', r.json.gate.items.find((i) => i.id === 'minutes').have >= 1);
  check('and that is enough with the gate lowered', r.json.gate.ok === true, JSON.stringify(r.json.gate.items.map((i) => `${i.id}:${i.done}`)));
  check('but still no Frost, because nothing was earned', r.json.frost === 0);
}

console.log('\n--- refusals at the cairn ---');
// Each of these asserts the REASON, not just the 409. A refusal that says
// "Slow down" is the rate limiter answering for a check that never ran, and
// the test would then still pass with the check deleted.
{
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: 'wood', x: 100, y: 100 } });
  check('offering from across the map is rejected', /cairn/i.test(r.json.error || ''), r.json.error);
}
{
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: 'nonesuch', x: cairn.x, y: cairn.y } });
  check('an invented offering is rejected on its own merits', /no such offering/i.test(r.json.error || ''), r.json.error);
}
{
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: '__proto__', x: cairn.x, y: cairn.y } });
  check('a prototype-pollution offering id is rejected', /no such offering/i.test(r.json.error || ''), r.json.error);
}
{
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: 'wood', x: cairn.x, y: cairn.y } });
  check('offering wood you do not have is rejected', /not enough wood/i.test(r.json.error || ''), r.json.error);
}
{
  // The point of checking input before the movement gate: a run of bad
  // requests must not be able to leave you rate-limited out of a real one.
  const r = await call('/api/season/offer', { method: 'POST', token, body: { id: 'nonesuch', x: cairn.x, y: cairn.y } });
  check('bad requests do not burn the action budget', /no such offering/i.test(r.json.error || ''), r.json.error);
}
{
  const before = (await call('/api/season/status', { token })).json.frost;
  check('none of those minted Frost', before === 0, `frost=${before}`);
}

console.log('\n--- captcha ---');
{
  const r = await call('/api/season/verify', { method: 'POST', token, body: { token: 'not-a-real-turnstile-token' } });
  check('a bogus captcha token never passes', r.status === 409, r.json.error);
  const s = await call('/api/season/status', { token });
  const human = s.json.gate.items.find((i) => i.id === 'human');
  check(
    'and no "verified" mark is left behind',
    !human || human.done === false,
    human ? `human:${human.done}` : 'captcha not configured on this deploy'
  );
}

/* --- earn it honestly ---------------------------------------------- */

const REACH = PLAYER.maxSpeed * PLAYER.iceSpeedBoost;
const SWING_GAP = Math.ceil(GATHER.swingMs * 0.6) + 60;
let at = { x: 0, y: 0, t: 0 };

async function travelTo(x, y) {
  if (!at.t) return;
  const dist = Math.hypot(x - at.x, y - at.y);
  const need = Math.max(0, ((dist - 200) / REACH) * 1000);
  await sleep(Math.max(0, Math.max(SWING_GAP, Math.ceil(need) + 150) - (Date.now() - at.t)));
}

async function work(node) {
  await travelTo(node.x, node.y);
  for (let i = 0; i < 12; i++) {
    const r = await call('/api/game/gather', {
      method: 'POST',
      token,
      body: { node: node.id, x: Math.round(node.x), y: Math.round(node.y) },
    });
    at = { x: node.x, y: node.y, t: Date.now() };
    if (r.status !== 200) {
      if (/breath|Slow/i.test(r.json.error || '')) {
        await sleep(5200);
        continue;
      }
      return null;
    }
    if (r.json.gained) return r.json.gained;
    await sleep(SWING_GAP);
  }
  return null;
}

function route(type, count) {
  const pool = getNodes().filter((x) => x.type === type);
  const out = [];
  let from = { x: WORLD.spawn.x, y: WORLD.spawn.y };
  while (out.length < count && pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i++) {
      if (Math.hypot(pool[i].x - from.x, pool[i].y - from.y) < Math.hypot(pool[best].x - from.x, pool[best].y - from.y)) best = i;
    }
    const [node] = pool.splice(best, 1);
    out.push(node);
    from = node;
  }
  return out;
}

const started = Date.now();
const mins = () => ((Date.now() - started) / 60000).toFixed(1);

const needWood = OFFERINGS.wood.cost.wood;
console.log(`\n--- chopping ${needWood} wood for an offering ---`);
let wood = 0;
for (const tree of route('tree', 45)) {
  if (wood >= needWood) break;
  const got = await work(tree);
  if (got?.wood) {
    wood += got.wood;
    process.stdout.write(`  ${wood}/${needWood} wood (${mins()}m)\r`);
  }
}
console.log('');
check('gathered enough for an offering', wood >= needWood, `${wood} wood in ${mins()}m`);

console.log('\n--- the cairn ---');
{
  await travelTo(cairn.x, cairn.y);
  const r = await call('/api/season/offer', {
    method: 'POST',
    token,
    body: { id: 'wood', x: Math.round(cairn.x), y: Math.round(cairn.y) },
  });
  at = { x: cairn.x, y: cairn.y, t: Date.now() };
  check('an offering is accepted', r.status === 200, r.json.error || `+${r.json.frost} frost`);
  check('it banked Frost', r.json.frost > 0, `+${r.json.frost}`);
  check('and it actually cost the wood', r.json.profile?.wood === wood - needWood, `${wood} -> ${r.json.profile?.wood}`);
}
{
  const r = await call('/api/season/status', { token });
  check('the ledger shows it', r.json.frost > 0, `frost=${r.json.frost}`);
  check('the day counter moved', r.json.offerToday > 0, `${r.json.offerToday}/${r.json.offerCap}`);
  check('the streak started at 1', r.json.streak === 1, `streak=${r.json.streak}`);
  check('the pool includes it', r.json.pool >= r.json.frost, `pool=${r.json.pool}`);
  check('a share is estimated', r.json.share > 0 && r.json.tokens > 0, `${(r.json.share * 100).toFixed(3)}% = ${r.json.tokens} $POG`);
  check('the multiplier is applied and explained', r.json.multipliers.total >= 1, `x${r.json.multipliers.total.toFixed(2)}`);
}
{
  const r = await call('/api/season/board');
  const me = r.json.entries.find((e) => e.frost > 0);
  check('the board lists the wallet', !!me, me && `#${me.rank} ${me.name} ${me.frost}`);
}
{
  // Frost is not spendable and no request may set it.
  const r = await call('/api/profile/set', {
    method: 'POST',
    token,
    body: { name: 'Season' + Math.floor(Math.random() * 9000 + 1000), color: '#38bdf8', frost: 999999 },
  });
  const after = (await call('/api/season/status', { token })).json.frost;
  check('a profile write cannot set Frost', r.status === 200 && after < 1000, `frost=${after}`);
}
{
  const before = (await call('/api/season/status', { token })).json.frost;
  const r = await call('/api/season/offer', {
    method: 'POST',
    token,
    body: { id: 'wood', x: Math.round(cairn.x), y: Math.round(cairn.y) },
  });
  const after = (await call('/api/season/status', { token })).json.frost;
  check('a second offering with no wood left is refused', /not enough wood/i.test(r.json.error || ''), r.json.error);
  check('and it changed nothing', after === before, `${before} -> ${after}`);
}

console.log(`\nOffering cap is ${OFFERING_DAILY_CAP} Frost/day; this run took ${mins()} minutes.`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
