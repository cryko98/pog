/**
 * Hand a wallet something, on the live store — for the team's own demo
 * penguin, nothing else.
 *
 *   node tools/gift.mjs <wallet>                       dry run: shows the pack
 *   node tools/gift.mjs <wallet> --item iglooKit --apply
 *   node tools/gift.mjs <wallet> --wood 50 --ice 20 --apply
 *
 * Reads the same Redis the API uses (pull the credentials with
 * `vercel env pull .vercel/.env.prod`), takes the wallet's own lock so a
 * live action cannot be undone by this write, and refuses without
 * --apply. It never touches Frost, playtime, or anything the airdrop
 * pays on.
 */

import { config } from 'dotenv';
import { Redis } from '@upstash/redis';

config({ path: '.vercel/.env.prod' });
config();

const args = process.argv.slice(2);
const wallet = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!wallet || wallet.length < 32) throw new Error('Usage: node tools/gift.mjs <wallet> [--item iglooKit] [--wood N] [--ice N] [--fish N] [--pog N] --apply');

const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) throw new Error('No Redis credentials in the environment.');
const redis = new Redis({ url, token });

const key = `pog:wallet:${wallet}`;
const lockKey = `pog:lock:${wallet}`;
const gift = {
  item: opt('item'),
  wood: Number(opt('wood')) || 0,
  ice: Number(opt('ice')) || 0,
  fish: Number(opt('fish')) || 0,
  pog: Number(opt('pog')) || 0,
};

const before = await redis.get(key);
if (!before) throw new Error('No profile for that wallet — it has to have picked a username first.');
console.log(`${before.name} (${wallet})`);
console.log(`  pack: wood ${before.wood} · ice ${before.ice} · fish ${before.fish} · P coins ${before.pog} · items ${JSON.stringify(before.items || {})}`);
console.log(`  gift: ${JSON.stringify(gift)}`);
if (!APPLY) {
  console.log('\nDry run. Add --apply to write it.');
  process.exit(0);
}

// the wallet's own lock, so a gather landing this second cannot put the old pack back
const lockToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
const got = await redis.set(lockKey, lockToken, { nx: true, px: 8000 });
if (got === null) throw new Error('The wallet is busy right now (a request holds its lock). Try again in a moment.');
try {
  const p = await redis.get(key);
  p.items = p.items || {};
  if (gift.item) p.items[gift.item] = (p.items[gift.item] || 0) + 1;
  for (const k of ['wood', 'ice', 'fish', 'pog']) if (gift[k] > 0) p[k] = (p[k] || 0) + gift[k];
  const ttl = await redis.ttl(key);
  await redis.set(key, p, ttl > 0 ? { ex: ttl } : undefined);
  console.log(`\nDone. pack: wood ${p.wood} · ice ${p.ice} · fish ${p.fish} · P coins ${p.pog} · items ${JSON.stringify(p.items)}`);
} finally {
  if ((await redis.get(lockKey)) === lockToken) await redis.del(lockKey);
}
