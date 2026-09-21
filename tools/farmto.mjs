/**
 * Plays honestly until a wallet holds an igloo kit, then prints the session
 * so you can pick it up in the browser and test the placement UI by hand.
 *
 *   BASE=http://localhost:5173 node tools/farmto.mjs [name]
 *
 * It respects every rule the API enforces — it walks between nodes at a
 * legal speed rather than teleporting — so a run takes a couple of minutes.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { WORLD, getNodes, RECIPES } from '../shared/world.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const NAME = (process.argv[2] || 'Builder') + Math.floor(Math.random() * 9000 + 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const { json: n } = await call(`/api/auth/nonce?wallet=${wallet}`);
const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey));
const { json: auth } = await call('/api/auth/verify', { method: 'POST', body: { wallet, signature: sig } });
const token = auth.token;
const named = await call('/api/profile/set', {
  method: 'POST',
  token,
  body: { name: NAME, color: '#facc15' },
});
if (named.status !== 200) {
  // without a profile every gather is refused, and the run would spin
  // through hundreds of no-ops before anyone noticed
  console.error('could not take the name ' + NAME + ': ' + named.json.error);
  process.exit(1);
}

let at = { x: WORLD.spawn.x, y: WORLD.spawn.y };
const TRAVEL_SPEED = 520;

async function travelTo(t) {
  await sleep(Math.max(950, (Math.hypot(t.x - at.x, t.y - at.y) / TRAVEL_SPEED) * 1000 + 150));
  at = { x: t.x, y: t.y };
}

let refusals = 0;
async function work(node) {
  await travelTo(node);
  const r = await call('/api/game/gather', {
    method: 'POST',
    token,
    body: { node: node.id, x: node.x, y: node.y },
  });
  if (r.status !== 200) {
    refusals++;
    // the per-minute cap is the usual reason; waiting it out is the honest fix
    if (/breath|Slow/i.test(r.json.error || '')) await sleep(6000);
    return null;
  }
  return r.json.profile;
}

function chain(list, start, count) {
  const out = [];
  let cur = start;
  const pool = [...list];
  for (let i = 0; i < count && pool.length; i++) {
    pool.sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y));
    const next = pool.shift();
    out.push(next);
    cur = next;
  }
  return out;
}

const { json: state } = await call('/api/game/state', { token });
const busy = new Set(state.depleted || []);
const nodes = getNodes();
const trees = nodes.filter((x) => x.type === 'tree' && !busy.has(x.id));
const iceNodes = nodes.filter((x) => x.type === 'ice' && !busy.has(x.id));

const NEED_WOOD = RECIPES.iglooKit.cost.wood;
const NEED_ICE = RECIPES.iglooKit.cost.ice;
console.log(`target: ${NEED_WOOD} wood + ${NEED_ICE} ice — the rate caps make this a long haul`);

let profile = null;
process.stdout.write('chopping');
for (const t of chain(trees, trees[0], 400)) {
  const p = await work(t);
  if (p) profile = p;
  process.stdout.write('.');
  if ((profile?.wood ?? 0) >= NEED_WOOD) break;
}
console.log(' wood =', profile?.wood);

process.stdout.write('cutting ice');
for (const node of chain(iceNodes, at, 400)) {
  const p = await work(node);
  if (p) profile = p;
  process.stdout.write('.');
  if ((profile?.ice ?? 0) >= NEED_ICE) break;
}
console.log(' ice =', profile?.ice);

const kit = await call('/api/game/craft', { method: 'POST', token, body: { recipe: 'iglooKit' } });
if (kit.status !== 200) {
  console.log('could not craft the kit:', kit.json.error);
  process.exit(1);
}

console.log('\nigloo kit ready. Paste this into the browser console on the site:\n');
console.log(
  `localStorage.setItem('pog.token','${token}');localStorage.setItem('pog.wallet','${wallet}');localStorage.removeItem('pog.guest');location.hash='#/play';location.reload()`
);
console.log(`\nname: ${NAME}`);
console.log(`last position: ${Math.round(at.x)}, ${Math.round(at.y)}`);
