/**
 * The shared, server-owned parts of the world. Player positions travel
 * peer-to-peer over MQTT, but anything worth cheating for lives here.
 *
 *   GET  coins                       -> { taken }   ids currently picked up
 *   POST claim { id }  (Bearer)      -> { pog }     credits one $POG
 *   GET  stats                       -> { online, wallets, coins }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BusyError } from '../../src/server/lock.js';
import { gateError } from '../../src/server/access.js';
import { actionOf, bearer, body, json } from '../_shared.js';
import { COIN } from '../../shared/world.js';
import { claimCoin, onlineCount, takenCoins, walletCount, walletForToken } from '../../src/server/game.js';
import { kvEnabled } from '../../src/server/kv.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'world');

  try {
    if (action === 'coins') {
      return json(res, 200, { taken: await takenCoins() });
    }

    if (action === 'stats') {
      const [online, wallets] = await Promise.all([onlineCount(), walletCount()]);
      return json(res, 200, { online, wallets, coins: COIN.count, persistent: kvEnabled() });
    }

    if (action === 'claim') {
      const wallet = await walletForToken(bearer(req) || body(req).token);
      if (!wallet) return json(res, 401, { error: 'No valid session.' });
      const shut = await gateError(wallet);
      if (shut) return json(res, 403, shut);

      const b = body(req);
      const result = await claimCoin(wallet, Number(b.id), b.x, b.y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { pog: result.pog });
    }

    return json(res, 404, { error: 'Unknown world action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
