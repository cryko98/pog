/**
 * Walks the whole survival loop the way a player would, respecting the
 * movement rules: chop wood, craft a rod, fish, cut ice, craft an igloo
 * kit, build the igloo, then buy and wear a skin.
 *
 *   BASE=http://localhost:5173 node tools/loopcheck.mjs
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { WORLD, getNodes, GATHER, isOnIce, solidsNear } from '../shared/world.js';

const BASE = process.env.BASE || 'http://localhost:5173';
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
await call('/api/profile/set', {
  method: 'POST',
  token,
  body: { name: 'Loop' + Math.floor(Math.random() * 9000 + 1000), color: '#34d399' },
});
console.log('signed in as', wallet.slice(0, 8) + '…');

const nodes = getNodes();
const trees = nodes.filter((x) => x.type === 'tree');
const iceNodes = nodes.filter((x) => x.type === 'ice');
const holes = nodes.filter((x) => x.type === 'hole');

// The API only accepts a position you could have walked to, so the test
// waits out the real travel time between nodes just like a player would.
let at = { x: WORLD.spawn.x, y: WORLD.spawn.y };
const TRAVEL_SPEED = 520; // world units per second, comfortably under the cap

async function travelTo(target) {
  const dist = Math.hypot(target.x - at.x, target.y - at.y);
  await sleep(Math.max(950, (dist / TRAVEL_SPEED) * 1000 + 150));
  at = { x: target.x, y: target.y };
}

/** Gather from a node, pacing requests so the movement rules are satisfied. */
async function work(node, label) {
  await travelTo(node);
  const r = await call('/api/game/gather', {
    method: 'POST',
    token,
    body: { node: node.id, x: node.x, y: node.y },
  });
  if (r.status !== 200) {
    console.log(`  ${label} refused: ${r.json.error}`);
    return null;
  }
  return r.json.profile;
}

/** Pick nodes close enough together that the walk is legal in ~1s. */
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

console.log('\n1. chopping wood (target 30)');
let profile = null;

// Skip anything a previous run already worked — cooldowns are shared
// across everyone, which is the point of them.
const { json: pre } = await call('/api/game/state', { token });
const onCooldown = new Set(pre.depleted || []);
const freshTrees = trees.filter((t) => !onCooldown.has(t.id));

for (const t of chain(freshTrees, freshTrees[0], 40)) {
  const p = await work(t, 'chop');
  if (p) profile = p;
  if ((profile?.wood ?? 0) >= 30) break;
}
console.log('   wood =', profile?.wood);

console.log('\n2. crafting a fishing rod (14 wood)');
{
  const r = await call('/api/game/craft', { method: 'POST', token, body: { recipe: 'rod' } });
  console.log(r.status === 200 ? `   rod crafted, wood left ${r.json.profile.wood}` : `   ${r.json.error}`);
  if (r.status === 200) profile = r.json.profile;
}

console.log('\n3. fishing (needs the rod)');
{
  // the movement rule applies, so approach the hole from its own position
  const hole = holes.sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y))[0];
  await travelTo(hole);
  const seed = await call('/api/game/gather', {
    method: 'POST',
    token,
    body: { node: hole.id, x: hole.x, y: hole.y },
  });
  console.log(
    seed.status === 200 ? `   caught ${JSON.stringify(seed.json.gained)}` : `   refused: ${seed.json.error}`
  );
  if (seed.status === 200) profile = seed.json.profile;
}

console.log('\n4. cutting ice (40 needed for a kit)');
{
  const freshIce = iceNodes.filter((i) => !onCooldown.has(i.id));
  const near = chain(freshIce, at, 30);
  for (const node of near) {
    const p = await work(node, 'cut');
    if (p) profile = p;
    if ((profile?.ice ?? 0) >= 40) break;
  }
  console.log('   ice =', profile?.ice, '| wood =', profile?.wood);
}

console.log('\n5. crafting the igloo kit (40 ice + 12 wood)');
{
  const r = await call('/api/game/craft', { method: 'POST', token, body: { recipe: 'iglooKit' } });
  console.log(r.status === 200 ? '   kit crafted' : `   ${r.json.error}`);
  if (r.status === 200) profile = r.json.profile;
}

console.log('\n6. building the igloo');
if (profile?.items?.iglooKit > 0) {
  // Find real buildable ground the same way the game would: dry snow,
  // clear of props, clear of the plaza.
  const spot = (() => {
    for (let r = 200; r < 1600; r += 60) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r;
        if (x < 200 || y < 200 || x > WORLD.width - 200 || y > WORLD.height - 200) continue;
        if (isOnIce(x, y, 60)) continue;
        if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < WORLD.spawnRadius + 200) continue;
        if (solidsNear(x, y).some((p) => Math.hypot(x - p.x, y - p.y) < p.r * p.scale + 100)) continue;
        return { x, y };
      }
    }
    return null;
  })();

  if (!spot) {
    console.log('   no buildable ground found nearby');
  } else {
    await travelTo(spot);
    const r = await call('/api/game/build', { method: 'POST', token, body: { ...spot, style: 'classic' } });
    console.log(
      r.status === 200 ? `   built at ${r.json.igloo.x},${r.json.igloo.y}` : `   refused: ${r.json.error}`
    );
  }
}

console.log('\n7. igloos visible to everyone');
{
  const r = await call('/api/game/igloos');
  console.log(`   ${r.json.igloos.length} igloo(s) in the world`);
}

console.log('\n8. shop');
{
  const before = await call('/api/game/state', { token });
  console.log('   $POG =', before.json.profile.pog, '| owned skins =', before.json.profile.skins.join(', '));
  const r = await call('/api/game/buy', { method: 'POST', token, body: { skin: 'beanie' } });
  console.log(r.status === 200 ? '   bought the beanie' : `   ${r.json.error} (expected with 0 $POG)`);
}

console.log('\n9. gather range is enforced end to end');
{
  await sleep(1100);
  const far = trees[trees.length - 1];
  const r = await call('/api/game/gather', {
    method: 'POST',
    token,
    body: { node: far.id, x: far.x, y: far.y },
  });
  console.log(`   distant tree: ${r.status === 200 ? 'ACCEPTED (bad!)' : 'refused — ' + r.json.error}`);
}

console.log('\nGATHER.range =', GATHER.range);
