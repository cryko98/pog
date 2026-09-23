/**
 * Furnishing, igloo levels, the daily $POG yield, and the igloo market.
 *
 *   GET  state                        -> igloo, level, catalogue, market
 *   POST buy      { id, qty }         -> a furnishing into the backpack
 *   POST place    { id, x, y }        -> stand one in your igloo
 *   POST remove   { index }           -> take one back out
 *   POST list     { price, currency } -> put the igloo up for sale
 *   POST unlist                       -> take it back off
 *   POST purchase { seller }          -> buy somebody else's, in soft $POG
 *   POST deposit  { wood, ice, fish, pog, items, x, y } -> from the pack into the igloo
 *   POST withdraw { ...same }         -> and back
 *
 * The on-chain market, live once POG_MINT is set:
 *
 *   POST reserve  { seller }              -> hold a real-token listing for ten minutes
 *   POST invoice  { seller }              -> the unsigned payment to sign
 *   POST settle   { seller, signature }   -> verify the payment on chain, hand over the igloo
 *   GET  sales                            -> the last on-chain sales
 *
 * Soft sales move soft $POG. Real sales move only the igloo. Nothing here
 * writes Frost.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CLOSED, actionOf, bearer, body, closed, json } from '../_shared.js';
import { getProfile, walletForToken } from '../../src/server/game.js';
import { qualified } from '../../src/server/season-gate.js';
import { chainLive } from '../../src/server/chain.js';
import { BusyError } from '../../src/server/lock.js';
import { gateError } from '../../src/server/access.js';
import {
  buyFurniture,
  buyIgloo,
  depositToIgloo,
  homeState,
  withdrawFromIgloo,
  listIgloo,
  placeFurniture,
  removeFurniture,
  settleYield,
  unlistIgloo,
} from '../../src/server/home.js';
import { recentSales, reserveSale, saleInvoice, settleSale } from '../../src/server/sale.js';

export default async function handler(req: any, res: any) {
  if (closed()) return json(res, 503, CLOSED);
  const action = actionOf(req, 'home');

  try {
    if (action === 'sales') {
      return json(res, 200, { sales: await recentSales(20) });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });
    const shut = await gateError(wallet);
    if (shut) return json(res, 403, shut);

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
      const { price, currency } = body(req);
      if (currency === 'pog' && !chainLive()) {
        return json(res, 409, { error: 'Real $POG sales open once the token is live.' });
      }
      // A market is the obvious laundering route for a sybil farm, so the
      // seller has to be a wallet that qualified for the season the hard
      // way — an hour of playtime, the captcha, the on-chain minimum.
      const gate = await qualified(wallet);
      if (!gate.ok) return json(res, 409, { error: `Not eligible to trade — ${gate.missing}.` });

      const result = await listIgloo(wallet, price, currency);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'deposit' || action === 'withdraw') {
      const { x, y, ...bundle } = body(req);
      const result = await (action === 'deposit' ? depositToIgloo : withdrawFromIgloo)(wallet, bundle, x, y);
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

    // --- the on-chain market ---------------------------------------
    if (action === 'reserve') {
      if (!chainLive()) return json(res, 409, { error: 'The token is not live yet.' });
      const gate = await qualified(wallet);
      if (!gate.ok) return json(res, 409, { error: `Not eligible to trade — ${gate.missing}.` });

      const result = await reserveSale(wallet, body(req).seller);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'invoice') {
      const result = await saleInvoice(wallet, body(req).seller);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'settle') {
      const { seller, signature } = body(req);
      const result = await settleSale(wallet, seller, signature);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown home action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
