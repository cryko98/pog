/**
 * Server-side "penguins online" count — a backstop for the MQTT presence
 * heartbeat, which can briefly collapse to 1 when the public broker hiccups
 * or a client is reconnecting. The UI shows whichever number is higher.
 *
 *   POST beat { id }  -> { count }
 *   GET  count        -> { count }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json } from '../_shared.js';
import { heartbeat, onlineCount, onlineHolders, walletForToken } from '../../src/server/game.js';
import { gateError } from '../../src/server/access.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'online');

  // Degrade quietly: a store hiccup must never break the game, so report 0
  // and let the client fall back to the MQTT count.
  try {
    if (action === 'beat') {
      const id = String(body(req).id || '').slice(0, 64);
      if (!id) return json(res, 400, { error: 'Missing id.' });
      // a signed-in player also accrues playtime, which is what their
      // carrying capacity is tied to
      const signedIn = await walletForToken(bearer(req));
      // a wallet that may not play is just a visitor here: no playtime, no Frost
      const wallet = signedIn && !(await gateError(signedIn)) ? signedIn : null;
      // Anyone can invent ids, so one address can only add so many
      // penguins a minute. Honest clients beat twice a minute; a shared
      // office NAT still fits under this.
      const raw = String(req.headers?.['x-forwarded-for'] || '');
      const ip = raw.split(',')[0]?.trim() || String(req.socket?.remoteAddress || 'local');
      return json(res, 200, { count: await heartbeat(id, wallet, ip) });
    }

    if (action === 'count') {
      return json(res, 200, { count: await onlineCount() });
    }

    // the online wallets that may chat; clients show chat from these only
    if (action === 'holders') {
      return json(res, 200, { wallets: await onlineHolders() });
    }

    return json(res, 404, { error: 'Unknown online action.' });
  } catch {
    return json(res, 200, { count: 0 });
  }
}
