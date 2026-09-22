/**
 * The honest version of the new loop, played at a human pace.
 *
 * Chops for a rod, fishes with it, cooks the catch into $POG at the plaza
 * fire, pockets a couple of coins, then claims all three daily quests and
 * checks the streak bonus landed.
 *
 *   BASE=http://localhost:5173 node tools/questcheck.mjs
 *
 * It picks a wallet whose three quests happen to be the cheapest set, so
 * the whole run is a few minutes rather than an evening. Quests are
 * derived from the address, so this is a search, not a cheat — the server
 * computes the same three independently.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { GATHER, PLAYER, RECIPES, dailyQuests, getCoins, getNodes } from '../shared/world.js';

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
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, json };
}

/* --- find a wallet with the cheapest possible quest set ------------- */

const WANT = { coins: 2, fish: 3, craft: 1 };

function favourable(wallet) {
  const qs = dailyQuests(wallet);
  if (qs.length !== 3) return false;
  return qs.every((q) => WANT[q.id] === q.target);
}

let kp = null;
let wallet = '';
for (let i = 0; i < 400_000; i++) {
  const candidate = nacl.sign.keyPair();
  const address = bs58.encode(candidate.publicKey);
  if (favourable(address)) {
    kp = candidate;
    wallet = address;
    break;
  }
}
if (!kp) {
  console.log('FAIL  could not find a wallet with the cheap quest set');
  process.exit(1);
}
console.log('wallet:', wallet);
console.log('quests:', dailyQuests(wallet).map((q) => `${q.label} (+${q.reward})`).join(' · '));

/* --- sign in -------------------------------------------------------- */

const { json: n } = await call(`/api/auth/nonce?wallet=${wallet}`);
const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey));
const { json: auth } = await call('/api/auth/verify', { method: 'POST', body: { wallet, signature } });
const token = auth.token;
const name = 'Quest' + Math.floor(Math.random() * 9000 + 1000);
const named = await call('/api/profile/set', { method: 'POST', token, body: { name, color: '#38bdf8' } });
if (named.status !== 200) {
  console.log('FAIL  could not take a username —', JSON.stringify(named.json));
  process.exit(1);
}

/* --- play ----------------------------------------------------------- */

const REACH = PLAYER.maxSpeed * PLAYER.iceSpeedBoost; // world units per second
const SWING_GAP = Math.ceil(GATHER.swingMs * 0.6) + 60;

/** Where the server last saw us, and when. `t: 0` means it has not yet. */
let at = { x: 0, y: 0, t: 0 };

/** Wait out the walk the server expects between two positions. */
async function travelTo(x, y) {
  if (!at.t) return; // nothing to walk from yet
  const dist = Math.hypot(x - at.x, y - at.y);
  const needMs = Math.max(0, ((dist - 200) / REACH) * 1000);
  const waited = Date.now() - at.t;
  await sleep(Math.max(0, Math.max(SWING_GAP, Math.ceil(needMs) + 150) - waited));
}

/** Work a node to completion, walking there first. Returns what it gave. */
async function work(node) {
  await travelTo(node.x, node.y);
  for (let swing = 0; swing < 12; swing++) {
    const r = await call('/api/game/gather', {
      method: 'POST',
      token,
      body: { node: node.id, x: Math.round(node.x), y: Math.round(node.y) },
    });
    at = { x: node.x, y: node.y, t: Date.now() };
    if (r.status !== 200) {
      // a cap or a neighbour beating us to it: back off and move on
      await sleep(/breath|Slow/i.test(r.json.error || '') ? 5200 : 400);
      if (/breath|Slow/i.test(r.json.error || '')) continue;
      return null;
    }
    if (r.json.gained) return r.json.gained;
    await sleep(SWING_GAP);
  }
  return null;
}

/** Nearest-neighbour walk over nodes of one type, starting from `at`. */
function route(type, count) {
  const pool = getNodes().filter((n) => n.type === type);
  const out = [];
  let from = { x: at.x, y: at.y };
  while (out.length < count && pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i++) {
      if (Math.hypot(pool[i].x - from.x, pool[i].y - from.y) < Math.hypot(pool[best].x - from.x, pool[best].y - from.y)) {
        best = i;
      }
    }
    const [node] = pool.splice(best, 1);
    out.push(node);
    from = node;
  }
  return out;
}

const started = Date.now();
const mins = () => ((Date.now() - started) / 60000).toFixed(1);

// 1. wood for a rod
const needWood = RECIPES.rod.cost.wood;
let wood = 0;
console.log(`\nchopping for ${needWood} wood…`);
for (const tree of route('tree', 40)) {
  if (wood >= needWood) break;
  const got = await work(tree);
  if (got?.wood) {
    wood += got.wood;
    process.stdout.write(`  ${wood}/${needWood} wood (${mins()}m)\r`);
  }
}
console.log('');
check('chopping reached the wood a rod costs', wood >= needWood, `${wood} wood in ${mins()}m`);

// 2. the rod itself — which is also the "craft 1 item" quest
{
  const r = await call('/api/game/craft', { method: 'POST', token, body: { recipe: 'rod' } });
  check('crafting a rod works', r.status === 200 && r.json.profile?.items?.rod === 1, r.json.error || '');
}
{
  const { json } = await call('/api/game/quests', { token });
  const craftQ = json.quests.find((q) => q.id === 'craft');
  check('the craft quest saw it', craftQ?.progress >= craftQ?.target, `${craftQ?.progress}/${craftQ?.target}`);
}

// 3. fish, enough for the cookout
const needFish = RECIPES.cookout.cost.fish;
let fish = 0;
console.log(`\nfishing for ${needFish} fish…`);
for (const hole of route('hole', 20)) {
  if (fish >= needFish) break;
  const got = await work(hole);
  if (got?.fish) {
    fish += got.fish;
    process.stdout.write(`  ${fish}/${needFish} fish (${mins()}m)\r`);
  }
}
console.log('');
check('fishing with a rod works', fish >= needFish, `${fish} fish in ${mins()}m`);

// 4. the cookout: fish becomes $POG
{
  const before = (await call('/api/game/state', { token })).json.profile.pog;
  const r = await call('/api/game/craft', { method: 'POST', token, body: { recipe: 'cookout' } });
  const after = r.json.profile?.pog ?? before;
  check(
    'the cookout turns fish into $POG',
    r.status === 200 && after === before + RECIPES.cookout.gives.pog,
    `${before} -> ${after}, fish left ${r.json.profile?.fish}`
  );
}
{
  const { json } = await call('/api/game/quests', { token });
  const fishQ = json.quests.find((q) => q.id === 'fish');
  check('the fishing quest filled up', fishQ?.progress >= fishQ?.target, `${fishQ?.progress}/${fishQ?.target}`);
}

// 5. a couple of coins off the ice
{
  const coins = getCoins();
  const taken = new Set((await call('/api/world/coins')).json.taken || []);
  let got = 0;
  console.log('\npicking up coins…');
  for (const coin of coins) {
    if (got >= WANT.coins) break;
    if (taken.has(coin.id)) continue;
    await travelTo(coin.x, coin.y);
    const r = await call('/api/world/claim', {
      method: 'POST',
      token,
      body: { id: coin.id, x: Math.round(coin.x), y: Math.round(coin.y) },
    });
    at = { x: coin.x, y: coin.y, t: Date.now() };
    if (r.status === 200) got++;
  }
  check('coins can still be picked up', got >= WANT.coins, `${got}/${WANT.coins}`);
}

// 6. claim everything, and check the streak bonus
{
  const { json: board } = await call('/api/game/quests', { token });
  check('all three quests are ready', board.claimable === 3, JSON.stringify(board.quests.map((q) => `${q.id} ${q.progress}/${q.target}`)));

  const before = (await call('/api/game/state', { token })).json.profile.pog;
  let paid = 0;
  let bonus = 0;
  for (const q of board.quests) {
    const r = await call('/api/game/quest', { method: 'POST', token, body: { id: q.id } });
    if (r.status === 200) {
      paid += r.json.reward;
      bonus += r.json.bonus;
    } else {
      check(`claiming ${q.id}`, false, r.json.error);
    }
  }
  const after = (await call('/api/game/state', { token })).json.profile.pog;
  check('every reward was paid exactly once', after === before + paid + bonus, `${before} -> ${after} (+${paid} +${bonus} streak)`);
  check('clearing all three started a streak', bonus === 1, `bonus=${bonus}`);

  const { json: again } = await call('/api/game/quests', { token });
  check('the board shows them claimed', again.quests.every((q) => q.claimed) && again.claimable === 0);
  check('the streak is now 1', again.streak === 1, `streak=${again.streak}`);

  const replay = await call('/api/game/quest', { method: 'POST', token, body: { id: board.quests[0].id } });
  check('a reward cannot be claimed twice', replay.status === 409, replay.json.error);

  const settled = (await call('/api/game/state', { token })).json.profile.pog;
  check('the replay paid nothing', settled === after, `${after} -> ${settled}`);
}

console.log(`\n${pass} passed, ${fail} failed  (${mins()} minutes)`);
process.exitCode = fail ? 1 : 0;
