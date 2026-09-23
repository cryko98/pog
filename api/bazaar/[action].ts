/**
 * The goods market: wood, ice and fish, player to player, for P coins.
 *
 *   GET  open                            -> every lot up for sale (public)
 *   POST list   { good, qty, each, x, y } -> put a lot up (the goods leave your pack now)
 *   POST unlist { id, x, y }             -> take one down
 *   POST buy    { id, qty, x, y }        -> buy some or all of a lot
 *
 * Both sides must have qualified for the season, and must be standing
 * at the market house.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CLOSED, actionOf, bearer, body, closed, json } from '../_shared.js';
import { BusyError } from '../../src/server/lock.js';
import { gateError } from '../../src/server/access.js';
import { walletForToken } from '../../src/server/game.js';
import { qualified } from '../../src/server/season-gate.js';
import { BAZAAR, buyLot, listLot, lots, unlistLot } from '../../src/server/bazaar.js';

export default async function handler(req: any, res: any) {
  if (closed()) return json(res, 503, CLOSED);
  const action = actionOf(req, 'bazaar');

  try {
    if (action === 'open') {
      return json(res, 200, { lots: await lots(), rules: BAZAAR });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });
    const shut = await gateError(wallet);
    if (shut) return json(res, 403, shut);

    if (action === 'list' || action === 'buy') {
      const gate = await qualified(wallet);
      if (!gate.ok) return json(res, 409, { error: `Not eligible to trade — ${gate.missing}.` });
    }

    if (action === 'list') {
      const { good, qty, each, x, y } = body(req);
      const result = await listLot(wallet, good, qty, each, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'unlist') {
      const { id, x, y } = body(req);
      const result = await unlistLot(wallet, id, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'buy') {
      const { id, qty, x, y } = body(req);
      const result = await buyLot(wallet, id, qty, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown market action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
