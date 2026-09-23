/**
 * Dev-only shortcuts, for testing things that would otherwise take a
 * twenty-minute grind — chiefly raising an igloo.
 *
 *   POST grant { wood, ice, fish, pog, items }  -> { profile }
 *   POST closeday { day }                        -> close a day of the airdrop now, even today
 *
 * ------------------------------------------------------------------ *
 * Three locks, because this mints resources out of nothing
 * ------------------------------------------------------------------ *
 *
 *  1. It does nothing unless POG_DEV_KEY is set, and the request has to
 *     present it. A flag would be one careless `vercel env add` away from
 *     being a faucet; a secret has to be handed out on purpose.
 *  2. It refuses outright on a production deployment, whatever the env
 *     says. VERCEL_ENV is set by the platform, not by us.
 *  3. It will not write Frost, the streak, or playtime — not under any
 *     key. Those are the airdrop ledger and the things that gate it, and
 *     a test shortcut has no business touching them. Grant yourself all
 *     the wood you like; you still qualify the same way everyone does.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, body, bearer, json } from '../_shared.js';
import { devGrant, walletForToken } from '../../src/server/game.js';
import { closeDay } from '../../src/server/airdrop.js';

const DEV_KEY = (process.env.POG_DEV_KEY || '').trim();
/**
 * Any Vercel deployment at all — not just production. The Redis database
 * is shared across Production, Preview and Development on this project,
 * so a grant on a preview URL would mint straight into the live economy.
 * Testing shortcuts belong on localhost, which is where the igloo gets
 * tested anyway.
 */
const IS_DEPLOYED = !!process.env.VERCEL || process.env.VERCEL_ENV === 'production';

export default async function handler(req: any, res: any) {
  if (IS_DEPLOYED) return json(res, 404, { error: 'Not found.' });
  if (!DEV_KEY) {
    return json(res, 404, { error: 'Dev routes are off. Set POG_DEV_KEY to enable them locally.' });
  }

  const presented = String(req.headers?.['x-dev-key'] || body(req).devKey || '');
  if (presented !== DEV_KEY) return json(res, 401, { error: 'Bad dev key.' });

  const action = actionOf(req, 'dev');

  try {
    if (action === 'grant') {
      const wallet = await walletForToken(bearer(req) || body(req).token);
      if (!wallet) return json(res, 401, { error: 'No valid session.' });

      const result = await devGrant(wallet, body(req));
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'closeday') {
      const day = String(body(req).day || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json(res, 409, { error: 'Which day?' });
      return json(res, 200, { record: await closeDay(day, true) });
    }

    return json(res, 404, { error: 'Unknown dev action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
