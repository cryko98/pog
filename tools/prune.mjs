/**
 * Removes throwaway profiles the test suites leave behind in production —
 * the `Cheat####`, `Loop####`, `Quest####` and `Hacker` accounts — so the
 * live leaderboard only ever shows real players.
 *
 *   node --env-file=.vercel/.env.prod tools/prune.mjs          # list them
 *   node --env-file=.vercel/.env.prod tools/prune.mjs --delete # remove them
 *
 * Needs the Upstash credentials, which `vercel env pull` writes.
 */

import { Redis } from '@upstash/redis';

const url = process.env.POG_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token =
  process.env.POG_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error('No Upstash credentials. Run: npx vercel env pull .vercel/.env.prod --environment=production');
  process.exit(1);
}

const redis = new Redis({ url, token });
const commit = process.argv.includes('--delete');

/** Names the test tools use. Anything else is somebody's real penguin. */
const TEST_NAME = /^(cheat|loop|quest|prodcheck|farm)\d*$|^hacker$/i;

const names = (await redis.hgetall('pog:names')) || {};
const doomed = Object.entries(names).filter(([name]) => TEST_NAME.test(name));

if (!doomed.length) {
  console.log('Nothing to prune — the leaderboard is all real players.');
  process.exit(0);
}

for (const [name, wallet] of doomed) {
  console.log(`${commit ? 'deleting' : 'would delete'}  ${name}  ${wallet}`);
  if (!commit) continue;
  await redis.del(`pog:wallet:${wallet}`);
  await redis.hdel('pog:names', name);
  await redis.zrem('pog:lb', wallet);
}

console.log(`\n${doomed.length} ${commit ? 'pruned' : 'would be pruned'}. ${commit ? '' : 'Re-run with --delete.'}`);
