/**
 * Measures how fast an honest player can actually gather, and turns that
 * into a time-to-igloo. Runs for ~45s instead of playing the whole grind.
 *
 *   BASE=http://localhost:5173 node tools/ratecheck.mjs
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { WORLD, getNodes, RECIPES, GATHER, GATHER_PER_MIN } from '../shared/world.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const SECONDS = Number(process.env.SECONDS || 45);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
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

const name = 'Rate' + Math.floor(Math.random() * 90000 + 10000);
const named = await call('/api/profile/set', { method: 'POST', token, body: { name, color: '#38bdf8' } });
if (named.status !== 200) {
  console.error('could not take a name:', named.json.error);
  process.exit(1);
}

const { json: state } = await call('/api/game/state', { token });
const busy = new Set(state.depleted || []);
const trees = getNodes().filter((t) => t.type === 'tree' && !busy.has(t.id));

// walk the nearest-neighbour chain, paying real travel time
let at = { x: WORLD.spawn.x, y: WORLD.spawn.y };
const TRAVEL_SPEED = 520;
const order = [];
{
  let cur = trees[0];
  const pool = [...trees];
  while (pool.length && order.length < 200) {
    pool.sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y));
    cur = pool.shift();
    order.push(cur);
  }
}

const started = Date.now();
let wood = 0;
let refused = 0;
const reasons = new Map();

for (const node of order) {
  if (Date.now() - started > SECONDS * 1000) break;
  const dist = Math.hypot(node.x - at.x, node.y - at.y);
  await sleep(Math.max(850, (dist / TRAVEL_SPEED) * 1000 + 120));
  at = { x: node.x, y: node.y };

  const r = await call('/api/game/gather', {
    method: 'POST',
    token,
    body: { node: node.id, x: node.x, y: node.y },
  });
  if (r.status === 200) wood = r.json.profile.wood;
  else {
    refused++;
    reasons.set(r.json.error, (reasons.get(r.json.error) || 0) + 1);
  }
}

const mins = (Date.now() - started) / 60000;
const perMin = wood / mins;
const need = RECIPES.iglooKit.cost;

console.log(`\nmeasured over ${mins.toFixed(1)} min of honest play:`);
console.log(`  wood banked      ${wood}  (${perMin.toFixed(1)}/min)`);
console.log(`  requests refused ${refused}`);
for (const [why, count] of reasons) console.log(`    ${count}x ${why}`);
console.log(`\ntheoretical ceiling: ${GATHER_PER_MIN.tree * GATHER.tree.yields.wood}/min`);
console.log(`igloo needs ${need.wood} wood + ${need.ice} ice`);
console.log(
  `  -> ~${(need.wood / perMin).toFixed(0)} min of chopping at the measured rate` +
    `, plus ~${(need.ice / (GATHER_PER_MIN.ice * GATHER.ice.yields.ice)).toFixed(0)} min of ice at the cap`
);
