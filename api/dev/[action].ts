/**
 * Dev-only shortcuts, for testing things that would otherwise take a
 * twenty-minute grind — chiefly raising an igloo.
 *
 *   POST grant { wood, ice, fish, pog, items }  -> { profile }
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

const DEV_KEY = (process.env.POG_DEV_KEY || '').trim();
const IS_PRODUCTION = process.env.VERCEL_ENV === 'production';

export default async function handler(req: any, res: any) {
  if (IS_PRODUCTION) return json(res, 404, { error: 'Not found.' });
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

    return json(res, 404, { error: 'Unknown dev action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
