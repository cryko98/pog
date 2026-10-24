/**
 * Wipe the live store: every player, igloo, coin, listing, match, run,
 * bet, closed airdrop day and session. A fresh start, for a relaunch.
 *
 *   node tools/wipe.mjs                  dry run: counts what is there
 *   node tools/wipe.mjs --wipe-everything
 *
 * It dumps every key to snapshots/wipe-<timestamp>.json BEFORE deleting
 * anything, so the old world can at least be read back. Reads the same
 * Redis the API uses (`vercel env pull .vercel/.env.prod`). The flag is
 * long on purpose.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { Redis } from '@upstash/redis';

config({ path: '.vercel/.env.prod' });
config();

const WIPE = process.argv.includes('--wipe-everything');
const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token) throw new Error('No Redis credentials in the environment.');
const redis = new Redis({ url, token });

// every key, by scanning
const keys = [];
let cursor = '0';
do {
  const [next, batch] = await redis.scan(cursor, { count: 1000 });
  cursor = String(next);
  keys.push(...batch);
} while (cursor !== '0');

const byPrefix = {};
for (const k of keys) {
  const p = k.split(':').slice(0, 2).join(':');
  byPrefix[p] = (byPrefix[p] || 0) + 1;
}
console.log(`${keys.length} keys`);
for (const [p, n] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(22)} ${n}`);
const players = keys.filter((k) => k.startsWith('pog:wallet:')).length;
console.log(`\n${players} player profiles, ${keys.filter((k) => k.startsWith('pog:cave:')).length} cave runs, ${keys.filter((k) => k.startsWith('pog:match:')).length} matches`);

if (!WIPE) {
  console.log('\nDry run. Add --wipe-everything to dump and delete all of it.');
  process.exit(0);
}

// dump first, whatever the type
mkdirSync('snapshots', { recursive: true });
const dump = {};
for (const k of keys) {
  const type = await redis.type(k);
  try {
    if (type === 'string') dump[k] = { type, value: await redis.get(k) };
    else if (type === 'hash') dump[k] = { type, value: await redis.hgetall(k) };
    else if (type === 'zset') dump[k] = { type, value: await redis.zrange(k, 0, -1, { withScores: true }) };
    else if (type === 'list') dump[k] = { type, value: await redis.lrange(k, 0, -1) };
    else if (type === 'set') dump[k] = { type, value: await redis.smembers(k) };
    else dump[k] = { type };
  } catch (err) {
    dump[k] = { type, error: String(err) };
  }
}
const file = `snapshots/wipe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), keys: keys.length, dump }, null, 1));
console.log(`\ndumped ${keys.length} keys to ${file}`);

// then delete, in batches
let gone = 0;
for (let i = 0; i < keys.length; i += 200) {
  const slice = keys.slice(i, i + 200);
  gone += Number(await redis.del(...slice)) || 0;
}
const left = await redis.dbsize();
console.log(`deleted ${gone} keys; ${left} left in the database`);
