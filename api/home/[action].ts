/**
 * Furnishing, igloo levels, the daily $POG yield, and the igloo market.
 *
 *   GET  state                      -> igloo, level, catalogue, market
 *   POST buy     { id, qty }        -> a furnishing into the backpack
 *   POST place   { id, x, y }       -> stand one in your igloo
 *   POST remove  { index }          -> take one back out
 *   POST list    { price }          -> put the igloo up for sale
 *   POST unlist                     -> take it back off
 *   POST purchase { seller }        -> buy somebody else's
 *
 * Everything is soft $POG. Nothing here writes Frost.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json } from '../_shared.js';
import { getProfile, walletForToken } from '../../src/server/game.js';
import { qualified } from '../../src/server/season-gate.js';
import {
  buyFurniture,
  buyIgloo,
  homeState,
  listIgloo,
  placeFurniture,
  removeFurniture,
  settleYield,
  unlistIgloo,
} from '../../src/server/home.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'home');

  try {
    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });

    if (action === 'state') {
      // Reading your own state is what settles the yield, so from the
      // player's side it simply arrives when they next play.
      const { paid } = await settleYield(wallet);
      const state = await homeState(wallet);
      return json(res, 200, { ...state, collected: paid, profile: await getProfile(wallet) });
    }

    if (action === 'buy') {
      const { id, qty } = body(req);
      const result = await buyFurniture(wallet, id, qty);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'place') {
      const { id, x, y } = body(req);
      const result = await placeFurniture(wallet, id, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'remove') {
      const result = await removeFurniture(wallet, body(req).index);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'list') {
      // A market is the obvious laundering route for a sybil farm, so the
      // seller has to be a wallet that qualified for the season the hard
      // way — an hour of playtime, the captcha, the on-chain minimum.
      const gate = await qualified(wallet);
      if (!gate.ok) return json(res, 409, { error: `Not eligible to trade — ${gate.missing}.` });

      const result = await listIgloo(wallet, body(req).price);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'unlist') {
      const result = await unlistIgloo(wallet);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'purchase') {
      const gate = await qualified(wallet);
      if (!gate.ok) return json(res, 409, { error: `Not eligible to trade — ${gate.missing}.` });

      const result = await buyIgloo(wallet, body(req).seller);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown home action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
