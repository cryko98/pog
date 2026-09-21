/**
 * The shared, server-owned parts of the world. Player positions travel
 * peer-to-peer over MQTT, but anything worth cheating for lives here.
 *
 *   GET  coins                       -> { taken }   ids currently picked up
 *   POST claim { id }  (Bearer)      -> { pog }     credits one $POG
 *   GET  stats                       -> { online, wallets, coins }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json } from '../_shared';
import { COIN } from '../../shared/world.js';
import { claimCoin, onlineCount, takenCoins, walletCount, walletForToken } from '../../src/server/game';
import { kvEnabled } from '../../src/server/kv';

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

      const result = await claimCoin(wallet, Number(body(req).id));
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { pog: result.pog });
    }

    return json(res, 404, { error: 'Unknown world action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
