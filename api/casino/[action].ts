/**
 * The casino: P coins on a provably fair roll.
 *
 *   GET  state                                   -> today's commitment, your recent bets, the rules
 *   POST bet { game, choice, wager, clientSeed, x, y } -> one roll, settled at once
 *   GET  reveal?day=YYYY-MM-DD                   -> a past day's seed, for checking (public)
 *
 * The wager leaves the balance and the win lands in one step under the
 * wallet lock; the roll comes from a seed committed to before the bet.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json, query } from '../_shared.js';
import { BusyError } from '../../src/server/lock.js';
import { gateError } from '../../src/server/access.js';
import { walletForToken } from '../../src/server/game.js';
import { casinoState, placeBet, revealSeed } from '../../src/server/casino.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'casino');

  try {
    if (action === 'reveal') {
      return json(res, 200, await revealSeed(query(req, 'day')));
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });
    const shut = await gateError(wallet);
    if (shut) return json(res, 403, shut);

    if (action === 'state') {
      return json(res, 200, await casinoState(wallet));
    }

    if (action === 'bet') {
      const { game, choice, wager, clientSeed, x, y } = body(req);
      const result = await placeBet(wallet, game, choice, wager, clientSeed, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown casino action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
