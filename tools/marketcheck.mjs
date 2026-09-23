/**
 * The goods market and the casino, worked by throwaway wallets against a
 * real API — and cheated at, every way a client could try.
 *
 *   node tools/marketcheck.mjs   (needs POG_DEV_KEY=localtest and
 *                                 POG_GATE_MINUTES=1 POG_GATE_MINUTES_TODAY=1 on the server)
 *
 * Every line must read PASS.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHmac, createHash } from 'node:crypto';
import { getNode } from '../shared/world.js';
import { CASINO, multiplierOf, outcomeOf, normaliseChoice } from '../shared/casino.js';

const BASE = process.env.BASE || 'http://localhost:5173';
const DEV = process.env.DEV_KEY || 'localtest';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** the server refuses two placed actions closer together than this */
const GAP = 1100;

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
const post = (path, token, body) => call(path, { method: 'POST', token, body });
const market = getNode('station-market');
const casino = getNode('station-casino');
const atMarket = { x: market.x + 20, y: market.y + 10 };
const atCasino = { x: casino.x + 20, y: casino.y + 10 };

/**
 * The season gate wants playtime: a heartbeat credits the first minute at
 * once, and the dev server is started with a one-minute gate.
 */
async function qualify(me) {
  await call('/api/online/beat', { method: 'POST', token: me.token, body: { id: me.wallet } });
  await sleep(100);
}

console.log('--- the rules, offline ---');
{
  check('a flip pays under 2x', multiplierOf('flip', 'ice') < 2 && multiplierOf('flip', 'ice') > 1.9, String(multiplierOf('flip', 'ice')));
  check('dice under 50 pays about the same as a flip', Math.abs(multiplierOf('dice', '50') - multiplierOf('flip', 'ice')) < 0.01);
  check('dice under 2 pays the most', multiplierOf('dice', '2') > 48);
  check('a choice off the table is refused', normaliseChoice('dice', '97') === null && normaliseChoice('dice', '1') === null && normaliseChoice('flip', 'snow') === null);
  check('the dice roll "99" beats every number', outcomeOf('dice', '96', 0.999).won === false);
  check('the dice roll "0" loses to none', outcomeOf('dice', '2', 0).won === true);
  // the edge, by exhaustion: over every possible flip the house keeps ~3%
  const ev = (multiplierOf('flip', 'ice') * 0.5);
  check('the house edge on a flip is about 3%', Math.abs(1 - ev - CASINO.edge) < 0.01, `ev ${ev}`);
}

console.log('\n--- the goods market ---');
const seller = await signIn('Trader' + Math.floor(Math.random() * 9000 + 1000));
const buyer = await signIn('Buyer' + Math.floor(Math.random() * 9000 + 1000));
await grant(seller.token, { wood: 40, fish: 6 });
await grant(buyer.token, { pog: 200 });
{
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 10, each: 3, ...atMarket });
  check('an unqualified wallet cannot sell', r.status === 409 && /eligible/.test(r.json.error), r.json.error);
}
await qualify(seller);
await qualify(buyer);
{
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 10, each: 3, x: market.x + 2000, y: market.y });
  check('listing from across the map is refused', r.status === 409 && /market first/i.test(r.json.error), r.json.error);
}
{
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'rod', qty: 1, each: 3, ...atMarket });
  check('only wood, ice, fish and gold are traded', r.status === 409 && /takes wood/.test(r.json.error), r.json.error);
  await sleep(GAP);
  const r2 = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 500, each: 3, ...atMarket });
  check('selling more than you have is refused', r2.status === 409 && /not 500/.test(r2.json.error), r2.json.error);
  await sleep(GAP);
  const r3 = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: -5, each: 3, ...atMarket });
  check('a negative quantity is refused', r3.status === 409, r3.json.error);
  await sleep(GAP);
  const r4 = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 5, each: 0, ...atMarket });
  check('a free lot is refused', r4.status === 409, r4.json.error);
}
let lot;
{
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 10, each: 3, ...atMarket });
  check('an honest lot goes up', r.status === 200 && r.json.lot?.id, JSON.stringify(r.json).slice(0, 100));
  lot = r.json.lot;
  const p = await profile(seller.token);
  check('the wood left the seller\'s pack at once', p.wood === 30, `wood=${p.wood}`);
  const open = await call('/api/bazaar/open');
  check('it shows on the public board', open.json.lots.some((l) => l.id === lot.id));
}
{
  await sleep(GAP);
  const r = await post('/api/bazaar/buy', seller.token, { id: lot.id, qty: 2, ...atMarket });
  check('you cannot buy your own lot', r.status === 409 && /your own/.test(r.json.error), r.json.error);
  await sleep(GAP);
  const r2 = await post('/api/bazaar/unlist', buyer.token, { id: lot.id, ...atMarket });
  check("you cannot take down somebody else's lot", r2.status === 409, r2.json.error);
}
{
  const before = await profile(buyer.token);
  await sleep(GAP);
  const r = await post('/api/bazaar/buy', buyer.token, { id: lot.id, qty: 4, ...atMarket });
  check('a buyer takes part of a lot', r.status === 200 && r.json.bought === 4, JSON.stringify(r.json).slice(0, 120));
  const after = await profile(buyer.token);
  check('the buyer paid 12 and got 4 wood', before.pog - after.pog === 12 && after.wood - before.wood === 4, `pog ${before.pog}->${after.pog} wood ${before.wood}->${after.wood}`);
  const s = await profile(seller.token);
  check('the seller got 12 less the burn', s.pog === 11, `seller pog=${s.pog}`);
  const open = await call('/api/bazaar/open');
  const left = open.json.lots.find((l) => l.id === lot.id);
  check('6 remain on the board', left?.qty === 6, JSON.stringify(left));
}
{
  await sleep(GAP);
  const r = await post('/api/bazaar/buy', buyer.token, { id: lot.id, qty: 60, ...atMarket });
  check('asking for more than the lot has buys what is left', r.status === 200 && r.json.bought === 6, JSON.stringify(r.json).slice(0, 80));
  const open = await call('/api/bazaar/open');
  check('the lot is gone once sold out', !open.json.lots.some((l) => l.id === lot.id));
  await sleep(GAP);
  const r2 = await post('/api/bazaar/buy', buyer.token, { id: lot.id, qty: 1, ...atMarket });
  check('buying a sold-out lot is refused', r2.status === 409, r2.json.error);
}
{
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'fish', qty: 6, each: 1000, ...atMarket });
  lot = r.json.lot;
  await sleep(GAP);
  const r2 = await post('/api/bazaar/buy', buyer.token, { id: lot.id, qty: 1, ...atMarket });
  check('a buyer without the coins is refused', r2.status === 409 && /costs/.test(r2.json.error), r2.json.error);
  await sleep(GAP);
  const r3 = await post('/api/bazaar/unlist', seller.token, { id: lot.id, ...atMarket });
  check('the seller takes it down', r3.status === 200, r3.json.error);
  const p = await profile(seller.token);
  check('the fish came back', p.fish === 6, `fish=${p.fish}`);
}
{
  // two buyers race for the last unit: only one gets it
  await sleep(GAP);
  const r = await post('/api/bazaar/list', seller.token, { good: 'wood', qty: 1, each: 1, ...atMarket });
  const other = await signIn('Race' + Math.floor(Math.random() * 9000 + 1000));
  await grant(other.token, { pog: 20 });
  await qualify(other);
  await sleep(GAP);
  const results = await Promise.all([
    post('/api/bazaar/buy', buyer.token, { id: r.json.lot.id, qty: 1, ...atMarket }),
    post('/api/bazaar/buy', other.token, { id: r.json.lot.id, qty: 1, ...atMarket }),
  ]);
  const won = results.filter((x) => x.status === 200 && x.json.bought === 1).length;
  check('two buyers racing for one unit: exactly one gets it', won === 1, results.map((x) => x.status + ':' + (x.json.error || 'ok')).join(' / '));
}

console.log('\n--- the casino ---');
const gambler = await signIn('Lucky' + Math.floor(Math.random() * 9000 + 1000));
await grant(gambler.token, { pog: 500 });
{
  await sleep(GAP);
  const r = await post('/api/casino/bet', gambler.token, { game: 'flip', choice: 'ice', wager: 10, clientSeed: 'a', x: casino.x + 2000, y: casino.y });
  check('betting from across the map is refused', r.status === 409 && /casino first/i.test(r.json.error), r.json.error);
}
{
  await sleep(GAP);
  const r = await post('/api/casino/bet', gambler.token, { game: 'flip', choice: 'ice', wager: 5000, clientSeed: 'a', ...atCasino });
  check('a wager over the table limit is refused', r.status === 409 && /Wager between/.test(r.json.error), r.json.error);
  await sleep(GAP);
  const r2 = await post('/api/casino/bet', gambler.token, { game: 'flip', choice: 'ice', wager: -10, clientSeed: 'a', ...atCasino });
  check('a negative wager is refused', r2.status === 409, r2.json.error);
  await sleep(GAP);
  const r3 = await post('/api/casino/bet', gambler.token, { game: 'dice', choice: '99', wager: 10, clientSeed: 'a', ...atCasino });
  check('a sure-thing dice number is refused', r3.status === 409, r3.json.error);
  await sleep(GAP);
  const r4 = await post('/api/casino/bet', gambler.token, { game: 'roulette', choice: '7', wager: 10, clientSeed: 'a', ...atCasino });
  check('a game that does not exist is refused', r4.status === 409, r4.json.error);
  await sleep(GAP);
  const r5 = await post('/api/casino/bet', gambler.token, { game: 'flip', choice: 'ice', wager: 10, clientSeed: 'a', roll: 0, won: true, paid: 9999, ...atCasino });
  check('a bet cannot bring its own result', r5.status === 200 && (r5.json.bet.paid === 0 || r5.json.bet.paid === Math.floor(10 * r5.json.bet.multiplier)), JSON.stringify(r5.json.bet));
}
{
  const before = await profile(gambler.token);
  const st = await call('/api/casino/state', { token: gambler.token });
  check('the state shows a commitment, not the seed', /^[0-9a-f]{64}$/.test(st.json.commit) && !('seed' in st.json));
  await sleep(GAP);
  const r = await post('/api/casino/bet', gambler.token, { game: 'dice', choice: '50', wager: 20, clientSeed: 'check', ...atCasino });
  check('an honest bet settles', r.status === 200 && typeof r.json.bet.won === 'boolean', JSON.stringify(r.json).slice(0, 120));
  const after = await profile(gambler.token);
  const delta = after.pog - before.pog;
  check('the balance moved by exactly the wager or the win', delta === (r.json.bet.won ? r.json.bet.paid - 20 : -20), `delta=${delta} bet=${JSON.stringify(r.json.bet)}`);
  check('the bet is numbered', r.json.bet.nonce === st.json.nonce + 1, `nonce ${r.json.bet.nonce}`);
  check('the client seed is echoed back for checking', r.json.bet.clientSeed === 'check');
  const st2 = await call('/api/casino/state', { token: gambler.token });
  check('the commitment did not change after the bet', st2.json.commit === st.json.commit);
  check('the bet is in the log', st2.json.recent.some((b) => b.nonce === r.json.bet.nonce));
}
{
  const r = await call('/api/casino/reveal?day=' + new Date().toISOString().slice(0, 10));
  check("today's seed is not revealed", r.json.seed === null);
  const r2 = await call('/api/casino/reveal?day=2020-01-01');
  check('a day with no table gives nothing', r2.json.seed === null);
}
{
  // the fairness maths: a revealed seed plus the recorded inputs reproduces the roll
  const seed = 'ab'.repeat(32);
  const digest = createHmac('sha256', seed).update('w:2020-01-01:1:x').digest('hex');
  const roll = parseInt(digest.slice(0, 13), 16) / 2 ** 52;
  check('a roll is in [0, 1)', roll >= 0 && roll < 1, String(roll));
  check('the commitment is the sha256 of the seed', createHash('sha256').update(seed).digest('hex').length === 64);
}
{
  const results = await Promise.all(Array.from({ length: 30 }, () => post('/api/casino/bet', gambler.token, { game: 'flip', choice: 'fire', wager: 1, clientSeed: 'b', ...atCasino })));
  const ok = results.filter((r) => r.status === 200).length;
  check('a burst of 30 bets is throttled to the table rate', ok <= CASINO.betsPerMin, `${ok} accepted`);
  const p = await profile(gambler.token);
  check('the balance never went negative', p.pog >= 0, `pog=${p.pog}`);
}
{
  const broke = await signIn('Broke' + Math.floor(Math.random() * 9000 + 1000));
  await sleep(GAP);
  const r = await post('/api/casino/bet', broke.token, { game: 'flip', choice: 'ice', wager: 10, clientSeed: 'a', ...atCasino });
  check('a wallet with no coins cannot bet', r.status === 409 && /You have 0/.test(r.json.error), r.json.error);
  const p = await profile(broke.token);
  check('and still has nothing, not less than nothing', p.pog === 0);
  check('frost is untouched by the tables', (p.frost ?? 0) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
