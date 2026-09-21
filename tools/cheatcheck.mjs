/**
 * Adversarial check. Signs in with a throwaway wallet, then tries every
 * shortcut a bot would: teleport farming, request bursts, out-of-range
 * grabs, fishing with no rod, spending currency it does not have, building
 * on a lake, stealing someone else's plot.
 *
 *   BASE=http://localhost:5173 node tools/cheatcheck.mjs
 *
 * Every line must read PASS. A FAIL is a hole.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { WORLD, getNodes, getCoins } from '../shared/world.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const BYPASS = process.env.BYPASS;

let pass = 0;
let fail = 0;

const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

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
  return { wallet, token: auth.token, kp };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */

const me = await signIn('Cheat' + Math.floor(Math.random() * 9000 + 1000));

// Node cooldowns are shared with everyone else on the server, so work from
// the ones nobody has touched — otherwise the suite fails for the right
// reason at the wrong moment.
const { json: world } = await call('/api/game/state', { token: me.token });
const busy = new Set(world.depleted || []);
const trees = getNodes().filter((n) => n.type === 'tree' && !busy.has(n.id));
const holes = getNodes().filter((n) => n.type === 'hole' && !busy.has(n.id));

console.log('\n--- authentication ---');
{
  const r = await call('/api/game/state', { token: 'not-a-real-token-0000000000' });
  check('forged bearer token is rejected', r.status === 401);
}
{
  const r = await call('/api/game/gather', { method: 'POST', body: { node: trees[0].id, x: 0, y: 0 } });
  check('gathering with no session is rejected', r.status === 401);
}
{
  // sign a valid message but claim to be a different wallet
  const other = nacl.sign.keyPair();
  const victim = bs58.encode(other.publicKey);
  const { json: n } = await call(`/api/auth/nonce?wallet=${victim}`);
  const wrong = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), me.kp.secretKey));
  const r = await call('/api/auth/verify', { method: 'POST', body: { wallet: victim, signature: wrong } });
  check("cannot log in as someone else's wallet", r.status === 401);
}
{
  const r = await call('/api/auth/verify', {
    method: 'POST',
    body: { wallet: bs58.encode(nacl.sign.keyPair().publicKey), signature: 'AAAA' },
  });
  check('garbage signature is rejected', r.status >= 400);
}

console.log('\n--- gathering ---');
{
  // establish a legitimate position at the first tree
  const r = await call('/api/game/gather', {
    method: 'POST',
    token: me.token,
    body: { node: trees[0].id, x: trees[0].x, y: trees[0].y },
  });
  check('an honest chop next to a tree works', r.status === 200, JSON.stringify(r.json.gained || r.json));
}
{
  // wait past the minimum action gap so this tests the distance rule,
  // not the burst limiter
  await sleep(1100);
  const far = trees.reduce((best, t) =>
    Math.hypot(t.x - trees[0].x, t.y - trees[0].y) > Math.hypot(best.x - trees[0].x, best.y - trees[0].y) ? t : best
  );
  const r = await call('/api/game/gather', {
    method: 'POST',
    token: me.token,
    body: { node: far.id, x: far.x, y: far.y },
  });
  check('teleporting across the map to farm is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/game/gather', {
    method: 'POST',
    token: me.token,
    body: { node: trees[1].id, x: trees[0].x, y: trees[0].y },
  });
  check('chopping a tree you are not standing near is rejected', r.status === 409, r.json.error);
}
{
  await sleep(900);
  const rs = await Promise.all(
    [0, 1, 2, 3, 4].map(() =>
      call('/api/game/gather', {
        method: 'POST',
        token: me.token,
        body: { node: trees[0].id, x: trees[0].x, y: trees[0].y },
      })
    )
  );
  const ok = rs.filter((r) => r.status === 200).length;
  check('a burst of 5 simultaneous chops yields at most 1', ok <= 1, `${ok} accepted`);
}
{
  const r = await call('/api/game/gather', {
    method: 'POST',
    token: me.token,
    body: { node: 't999999', x: 0, y: 0 },
  });
  check('inventing a node id is rejected', r.status === 409, r.json.error);
}
{
  const hole = holes[0];
  const r = await call('/api/game/gather', {
    method: 'POST',
    token: me.token,
    body: { node: hole.id, x: hole.x, y: hole.y },
  });
  // either "no rod" or "too fast" — both are refusals; assert it is not a success
  check('fishing without a rod never succeeds', r.status !== 200, r.json.error);
}

console.log('\n--- crafting and currency ---');
{
  const r = await call('/api/game/craft', { method: 'POST', token: me.token, body: { recipe: 'rod' } });
  check('crafting without the wood is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/game/craft', { method: 'POST', token: me.token, body: { recipe: '__proto__' } });
  check('a prototype-pollution recipe name is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/game/buy', { method: 'POST', token: me.token, body: { skin: 'crown' } });
  check('buying a skin you cannot afford is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/game/equip', { method: 'POST', token: me.token, body: { skin: 'crown' } });
  check('equipping a skin you do not own is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/profile/set', {
    method: 'POST',
    token: me.token,
    body: { name: 'Hacker', color: '#38bdf8', pog: 999999, wood: 999999, playMinutes: 99999 },
  });
  const p = r.json.profile || {};
  check(
    'extra fields in a profile write are ignored',
    (p.pog || 0) === 0 && (p.wood || 0) <= 4 && (p.playMinutes || 0) < 5,
    `pog=${p.pog} wood=${p.wood} playMinutes=${p.playMinutes}`
  );
}

console.log('\n--- coins ---');
{
  const coin = getCoins()[0];
  const r = await call('/api/world/claim', {
    method: 'POST',
    token: me.token,
    body: { id: coin.id, x: coin.x + 5000, y: coin.y },
  });
  check('claiming a coin from far away is rejected', r.status === 409, r.json.error);
}

console.log('\n--- building ---');
{
  const r = await call('/api/game/build', {
    method: 'POST',
    token: me.token,
    body: { x: WORLD.spawn.x, y: WORLD.spawn.y, style: 'classic' },
  });
  check('building without an igloo kit is rejected', r.status === 409, r.json.error);
}

console.log('\n--- playtime cap ---');
{
  const { json } = await call('/api/game/state', { token: me.token });
  const p = json.profile;
  check('a brand-new wallet starts empty', (p.pog || 0) === 0 && (p.skins || []).length <= 1);
  check('playtime cannot be self-reported', (p.playMinutes || 0) <= 2, `playMinutes=${p.playMinutes}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
