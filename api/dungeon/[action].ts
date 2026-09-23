/**
 * The bear caves.
 *
 *   GET  state?id=              -> your run, brought up to date (and settled if it ended)
 *   POST enter   { x, y }       -> go in, from the cave mouth
 *   POST input   { id, type, ... } -> something the player did, stamped on arrival
 *   GET  inputs?id=&since=      -> the log from that sequence on
 *
 * Nothing here takes a kill, a heart or a coin from a request. The server
 * replays the stamped log to know what happened; the client only ever
 * says what keys it pressed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json, query } from '../_shared.js';
import { BusyError } from '../../src/server/lock.js';
import { walletForToken } from '../../src/server/game.js';
import { caveInput, caveInputs, caveState, enterCave, viewOf } from '../../src/server/dungeon.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'dungeon');

  try {
    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });

    if (action === 'state') {
      const result = await caveState(wallet, query(req, 'id') || undefined);
      return json(res, 200, result);
    }

    if (action === 'enter') {
      const { x, y } = body(req);
      const result = await enterCave(wallet, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { run: viewOf(result.run!) });
    }

    if (action === 'input') {
      const { id, ...input } = body(req);
      const result = await caveInput(wallet, id, input);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'inputs') {
      const result = await caveInputs(wallet, query(req, 'id'), query(req, 'since'));
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown dungeon action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
