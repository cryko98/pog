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
import { WORLD, canBuildAt, getNodes, getCoins } from '../shared/world.js';

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
  check('an honest swing lands', r.status === 200, JSON.stringify(r.json));
  check(
    'one swing does not fell a tree',
    r.status === 200 && !r.json.gained && r.json.needed > 1,
    `hits ${r.json.hits}/${r.json.needed}`
  );
}
{
  // a burst cannot skip the remaining swings: the minimum gap between
  // actions rejects most of them outright
  const rs = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7].map(() =>
      call('/api/game/gather', {
        method: 'POST',
        token: me.token,
        body: { node: trees[0].id, x: trees[0].x, y: trees[0].y },
      })
    )
  );
  const landed = rs.filter((r) => r.status === 200).length;
  const felled = rs.filter((r) => r.status === 200 && r.json.gained).length;
  check('a burst of 8 swings cannot fell the tree', felled === 0, `${landed} landed, ${felled} felled`);
}
{
  // ...but swinging at a human pace does
  let gained = null;
  for (let i = 0; i < 8 && !gained; i++) {
    await sleep(320);
    const r = await call('/api/game/gather', {
      method: 'POST',
      token: me.token,
      body: { node: trees[0].id, x: trees[0].x, y: trees[0].y },
    });
    if (r.json.gained) gained = r.json.gained;
  }
  check('swinging at a human pace fells it', !!gained, JSON.stringify(gained));
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

console.log('\n--- tools ---');
{
  const { json } = await call('/api/game/state', { token: me.token });
  check('a fresh wallet holds exactly one starter axe', json.profile.items.axe === 1, JSON.stringify(json.profile.items));
  const ice = getNodes().find((n) => n.type === 'ice');
  const w = await signIn('Pick' + Math.floor(Math.random() * 9000 + 1000));
  const r = await call('/api/game/gather', { method: 'POST', token: w.token, body: { node: ice.id, x: ice.x, y: ice.y } });
  check('cutting ice without an ice pick is refused', r.status === 409 && /ice pick/.test(r.json.error), r.json.error);
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

console.log('\n--- the cookout (fish -> $POG) ---');
{
  const r = await call('/api/game/craft', { method: 'POST', token: me.token, body: { recipe: 'cookout' } });
  check('cooking with no fish is rejected', r.status === 409, r.json.error);
}
{
  const { json } = await call('/api/game/state', { token: me.token });
  check('a refused cookout minted no $POG', (json.profile?.pog || 0) === 0, `pog=${json.profile?.pog}`);
}

console.log('\n--- daily quests ---');
{
  const r = await call('/api/game/quests', { token: me.token });
  const ok = r.status === 200 && Array.isArray(r.json.quests) && r.json.quests.length === 3;
  check('the board serves exactly three quests', ok, JSON.stringify(r.json.quests?.map((q) => q.id)));
  check(
    'a fresh wallet has no streak and nothing to claim',
    (r.json.streak || 0) === 0 && (r.json.claimable || 0) === 0,
    `streak=${r.json.streak} claimable=${r.json.claimable}`
  );
  // the same wallet must always get the same three — no rerolling into easy ones
  const again = await call('/api/game/quests', { token: me.token });
  check(
    'quests cannot be rerolled',
    JSON.stringify(r.json.quests.map((q) => q.id + q.target)) ===
      JSON.stringify(again.json.quests.map((q) => q.id + q.target))
  );
  {
    const unfinished = r.json.quests.find((q) => q.progress < q.target);
    check('a fresh wallet has at least one unfinished quest', !!unfinished);
    if (unfinished) {
      const c = await call('/api/game/quest', {
        method: 'POST',
        token: me.token,
        body: { id: unfinished.id },
      });
      check('claiming an unfinished quest is rejected', c.status === 409, c.json.error);
    }
  }
}
{
  const r = await call('/api/game/quest', { method: 'POST', token: me.token, body: { id: 'nonesuch' } });
  check('claiming a quest you were not given is rejected', r.status === 409, r.json.error);
}
{
  const r = await call('/api/game/quest', { method: 'POST', token: me.token, body: { id: '__proto__' } });
  check('a prototype-pollution quest id is rejected', r.status === 409, r.json.error);
}

console.log('\n--- the season ledger ---');
{
  const r = await call('/api/season/status', { token: 'not-a-real-token-0000000000' });
  check('reading the Frost ledger needs a real session', r.status === 401);
}
{
  const cairn = getNodes().find((n) => n.id === 'station-cairn');
  const r = await call('/api/season/offer', { method: 'POST', body: { id: 'wood', x: cairn.x, y: cairn.y } });
  check('offering with no session is rejected', r.status === 401);
}
{
  const r = await call('/api/season/status', { token: me.token });
  check('a fresh wallet has no Frost', (r.json.frost || 0) === 0, `frost=${r.json.frost}`);
  check('and has not passed the gate', r.json.gate?.ok === false);
}
{
  // Frost is the airdrop ledger, so this is the write nobody may make.
  await call('/api/profile/set', {
    method: 'POST',
    token: me.token,
    body: { name: 'Hacker', color: '#38bdf8', frost: 999999, frostStreak: 99, playToday: 9999 },
  });
  const r = await call('/api/season/status', { token: me.token });
  check(
    'a profile write cannot inject Frost, a streak or playtime',
    (r.json.frost || 0) === 0 && (r.json.streak || 0) === 0,
    `frost=${r.json.frost} streak=${r.json.streak}`
  );
}
{
  // The architectural claim: there is no endpoint that hands out Frost.
  const attempts = ['credit', 'grant', 'award', 'add', 'set'];
  const answers = await Promise.all(
    attempts.map((a) =>
      call(`/api/season/${a}`, { method: 'POST', token: me.token, body: { amount: 999999, frost: 999999 } })
    )
  );
  check(
    'there is no endpoint that credits Frost',
    answers.every((r) => r.status === 404),
    answers.map((r, i) => `${attempts[i]}:${r.status}`).join(' ')
  );
}
{
  const r = await call('/api/season/verify', {
    method: 'POST',
    token: me.token,
    body: { token: 'forged-captcha-token' },
  });
  check('a forged captcha token is rejected', r.status === 409, r.json.error);
  const s = await call('/api/season/status', { token: me.token });
  const human = (s.json.gate?.items || []).find((i) => i.id === 'human');
  check('and leaves no verified mark', !human || human.done === false);
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

console.log('\n--- the jump home ---');
{
  // Players who have raised an igloo respawn at their own door, so that one
  // jump is allowed. A wallet with no igloo has no such allowance — and
  // there is no one-shot credit to burn, so a second attempt fails too.
  const far = trees.reduce((best, t) =>
    Math.hypot(t.x - trees[0].x, t.y - trees[0].y) > Math.hypot(best.x - trees[0].x, best.y - trees[0].y)
      ? t
      : best
  );
  for (const attempt of [1, 2]) {
    await sleep(1100);
    const r = await call('/api/game/gather', {
      method: 'POST',
      token: me.token,
      body: { node: far.id, x: far.x, y: far.y },
    });
    check(`a wallet with no igloo gets no free jump (attempt ${attempt})`, r.status === 409, r.json.error);
  }
}

console.log('\n--- playtime cap ---');
{
  const { json } = await call('/api/game/state', { token: me.token });
  const p = json.profile;
  check('a brand-new wallet starts empty', (p.pog || 0) === 0 && (p.skins || []).length <= 1);
  check('playtime cannot be self-reported', (p.playMinutes || 0) <= 2, `playMinutes=${p.playMinutes}`);
}

console.log('\n--- coins need a position ---');
{
  // A claim with no position used to skip both the range and the movement
  // checks — every coin on the map from anywhere, at the per-minute cap.
  const coin = getCoins()[1];
  const r = await call('/api/world/claim', { method: 'POST', token: me.token, body: { id: coin.id } });
  check('claiming a coin with no position is rejected', r.status === 409 && /where/i.test(r.json.error), r.json.error);
}

console.log('\n--- the plaza is not a teleporter ---');
{
  // Rejoining puts you on the plaza, so "I am at the plaza" has to be
  // allowed — once a minute. It must not be a free way back out again.
  const w = await signIn('Warp' + Math.floor(Math.random() * 9000 + 1000));
  const spawn = WORLD.spawn;
  const dist = (n) => Math.hypot(n.x - spawn.x, n.y - spawn.y);
  const far = trees.reduce((a, b) => (dist(b) > dist(a) ? b : a));
  // Coins keep well clear of the plaza now, so the plaza-side action is a
  // swing at the pine that stands just outside the ring: a real rejoin
  // acts from the plaza too, and the swing is taken from just inside it.
  const plazaTree = trees.filter((t) => dist(t) - 40 <= WORLD.spawnRadius).reduce((a, b) => (dist(b) < dist(a) ? b : a));
  const towards = Math.max(0, dist(plazaTree) - WORLD.spawnRadius + 8);
  const at = {
    x: plazaTree.x + ((spawn.x - plazaTree.x) / dist(plazaTree)) * towards,
    y: plazaTree.y + ((spawn.y - plazaTree.y) / dist(plazaTree)) * towards,
  };
  check('the far tree really is far from the plaza', dist(far) > 1500, `${Math.round(dist(far))}`);
  check('there is a pine reachable from the plaza ring', dist(at) <= WORLD.spawnRadius && Math.hypot(at.x - plazaTree.x, at.y - plazaTree.y) <= 86, `${Math.round(dist(at))}`);

  let r = await call('/api/game/gather', { method: 'POST', token: w.token, body: { node: far.id, x: far.x, y: far.y } });
  check('a fresh wallet can start at a far tree', r.status === 200, r.json.error);
  await sleep(1100);
  r = await call('/api/game/gather', { method: 'POST', token: w.token, body: { node: plazaTree.id, x: at.x, y: at.y } });
  check(
    'one jump to the plaza (a rejoin) is allowed',
    r.status === 200 || (r.status === 409 && !/two places/.test(r.json.error)),
    r.json.error || 'ok'
  );
  await sleep(1100);
  r = await call('/api/game/gather', { method: 'POST', token: w.token, body: { node: far.id, x: far.x, y: far.y } });
  check('but it is not a way back to the far tree', r.status === 409 && /two places/.test(r.json.error), r.json.error);
}

console.log('\n--- the market before the token exists ---');
{
  // Reasons are asserted, not just statuses: the season gate also answers
  // 409 here, and a test that passed on "play 60 minutes" would say nothing
  // about the market.
  const r = await call('/api/home/list', { method: 'POST', token: me.token, body: { price: 100, currency: 'pog' } });
  check('listing for real $POG is refused until the mint is configured', r.status === 409 && /token is live/.test(r.json.error), r.json.error);
  const r2 = await call('/api/home/reserve', { method: 'POST', token: me.token, body: { seller: me.wallet } });
  check('reserving an on-chain listing is refused too', r2.status === 409 && /not live/.test(r2.json.error), r2.json.error);
  const r3 = await call('/api/home/settle', {
    method: 'POST',
    token: me.token,
    body: { seller: me.wallet, signature: '5'.repeat(88) },
  });
  check('and so is presenting a payment', r3.status === 409 && /not live/.test(r3.json.error), r3.json.error);
}

console.log('\n--- names are claimed atomically ---');
{
  const name = 'Twin' + Math.floor(Math.random() * 900000 + 100000);
  const a = await signIn('A' + name.slice(4));
  const b = await signIn('B' + name.slice(4));
  const rs = await Promise.all(
    [a, b].map((s) => call('/api/profile/set', { method: 'POST', token: s.token, body: { name, color: '#38bdf8' } }))
  );
  const won = rs.filter((r) => r.status === 200).length;
  check('two wallets racing for one name: exactly one gets it', won === 1, rs.map((r) => r.status).join(','));
}

console.log('\n--- concurrency (needs POG_DEV_KEY=localtest on the server) ---');
{
  const DEV = process.env.DEV_KEY || 'localtest';
  const grant = (token, gift) =>
    call('/api/dev/grant', { method: 'POST', token, body: { ...gift, devKey: DEV } });

  const probe = await grant(me.token, {});
  if (probe.status === 404 || probe.status === 401) {
    console.log('skip  dev grants are off here, so the double-spend attacks cannot be staged');
  } else {
    // Double-spend by racing: five fish, four cookouts at once. Before the
    // wallet lock every one of them read "5 fish" and every one paid out.
    const c = await signIn('Race' + Math.floor(Math.random() * 9000 + 1000));
    await grant(c.token, { fish: 5 });
    const cooks = await Promise.all([0, 1, 2, 3].map(() => call('/api/game/craft', { method: 'POST', token: c.token, body: { recipe: 'cookout' } })));
    const cooked = cooks.filter((r) => r.status === 200).length;
    const { json: after } = await call('/api/game/state', { token: c.token });
    check('four racing cookouts on five fish: exactly one succeeds', cooked === 1, cooks.map((r) => r.status).join(','));
    check('...and the pack shows 0 fish, 1 $POG', after.profile.fish === 0 && after.profile.pog === 1, `fish=${after.profile.fish} pog=${after.profile.pog}`);

    // Fishing is on a clock: a second cast straight after the first is told
    // to wait, however fast the client asks. The clock is per wallet, so
    // it cannot be dodged by hopping holes either.
    let fishedAt = null;
    {
      await grant(c.token, { items: { rod: 1 } });
      const hole = holes[1] ?? holes[0];
      fishedAt = hole;
      await sleep(1100);
      const first = await call('/api/game/gather', { method: 'POST', token: c.token, body: { node: hole.id, x: hole.x, y: hole.y } });
      check('a cast with a rod is accepted', first.status === 200 && (first.json.escaped || first.json.catch), first.json.error || JSON.stringify(first.json.catch || 'escaped'));
      await sleep(300);
      const again = await call('/api/game/gather', { method: 'POST', token: c.token, body: { node: hole.id, x: hole.x, y: hole.y } });
      check('reeling in again at once is told to wait', again.status === 409 && /biting/i.test(again.json.error), again.json.error);
      const other = holes.find((h) => h.id !== hole.id && Math.hypot(h.x - hole.x, h.y - hole.y) < 400);
      if (other) {
        await sleep(300);
        const hop = await call('/api/game/gather', { method: 'POST', token: c.token, body: { node: other.id, x: other.x, y: other.y } });
        check('hopping to the next hole does not reset the clock', hop.status === 409 && /biting|two places|Slow/i.test(hop.json.error), hop.json.error);
      }
    }

    // Now the furniture dupe: one rug, placed twice at once; then removed
    // twice at once. Each has to net out to exactly one rug.
    await grant(c.token, { pog: 100, items: { iglooKit: 1 } });
    const { json: w } = await call('/api/game/igloos');
    const taken = w.igloos || [];
    let spot = null;
    for (let tries = 0; tries < 400 && !spot; tries++) {
      // within walking reach of where the wallet last acted, or the
      // movement rule refuses the build for the right reason
      const c0 = fishedAt ?? WORLD.spawn;
      const x = c0.x + (Math.random() - 0.5) * 700;
      const y = c0.y + (Math.random() - 0.5) * 700;
      if (canBuildAt(x, y, taken).ok) spot = { x: Math.round(x), y: Math.round(y) };
    }
    check('found clear snow to test on', !!spot);
    if (spot) {
      await sleep(1100);
      const built = await call('/api/game/build', { method: 'POST', token: c.token, body: { ...spot, style: 'classic' } });
      check('the test igloo went up', built.status === 200, built.json.error);
      await call('/api/home/buy', { method: 'POST', token: c.token, body: { id: 'rug', qty: 1 } });

      const places = await Promise.all([0, 1].map(() => call('/api/home/place', { method: 'POST', token: c.token, body: { id: 'rug', x: 0, y: -40 } })));
      const placed = places.filter((r) => r.status === 200).length;
      check('one rug placed twice at once: exactly one lands', placed === 1, places.map((r) => r.status + ':' + (r.json.error || 'ok')).join(' | '));

      const removes = await Promise.all([0, 1].map(() => call('/api/home/remove', { method: 'POST', token: c.token, body: { index: 0 } })));
      const removed = removes.filter((r) => r.status === 200).length;
      const { json: home } = await call('/api/home/state', { token: c.token });
      check('removed twice at once: exactly one comes back', removed === 1, removes.map((r) => r.status).join(','));
      check(
        '...and the world holds exactly one rug afterwards',
        (home.profile?.items?.f_rug || 0) + (home.pieces || []).length === 1,
        `pack=${home.profile?.items?.f_rug || 0} placed=${(home.pieces || []).length}`
      );

      // The igloo's store: only at home, only what you hold, never past the cap.
      {
        await grant(c.token, { wood: 10 });
        const away = await call('/api/home/deposit', { method: 'POST', token: c.token, body: { wood: 5, x: spot.x + 900, y: spot.y } });
        check('putting things away from far off is refused', away.status === 409 && /home/i.test(away.json.error), away.json.error);
        await sleep(1100);
        const before = await call('/api/game/state', { token: c.token });
        const much = await call('/api/home/deposit', { method: 'POST', token: c.token, body: { wood: before.json.profile.wood + 1, x: spot.x, y: spot.y } });
        check('putting away more than you hold is refused', much.status === 409 && /do not have/.test(much.json.error), much.json.error);
        await sleep(1100);
        const inn = await call('/api/home/deposit', { method: 'POST', token: c.token, body: { wood: 3, x: spot.x, y: spot.y } });
        check('three wood go into the igloo', inn.status === 200 && inn.json.igloo.store.wood === 3 && inn.json.profile.wood === before.json.profile.wood - 3, inn.json.error || `store=${inn.json.igloo?.store?.wood} pack=${inn.json.profile?.wood}`);
        await sleep(1100);
        const out = await call('/api/home/withdraw', { method: 'POST', token: c.token, body: { wood: 3, x: spot.x, y: spot.y } });
        check('and come back out whole', out.status === 200 && out.json.igloo.store.wood === 0 && out.json.profile.wood === before.json.profile.wood, out.json.error || `pack=${out.json.profile?.wood}`);
        await sleep(1100);
        const more = await call('/api/home/withdraw', { method: 'POST', token: c.token, body: { wood: 1, x: spot.x, y: spot.y } });
        check('taking out what is not there is refused', more.status === 409, more.json.error);
      }

      // A second kit no longer replaces the igloo and everything in it.
      await call('/api/home/place', { method: 'POST', token: c.token, body: { id: 'rug', x: 0, y: -40 } });
      await grant(c.token, { items: { iglooKit: 1 } });
      await sleep(1100);
      const again = await call('/api/game/build', { method: 'POST', token: c.token, body: { x: spot.x, y: spot.y, style: 'classic' } });
      check('raising a second kit moves the igloo instead of replacing it', again.status === 200 && (again.json.igloo?.furniture || []).length === 1, again.json.error || `furniture=${(again.json.igloo?.furniture || []).length}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
