/**
 * The snowball arena.
 *
 *   GET  open                          -> challenges waiting for a taker (public)
 *   GET  state?id=                     -> your match, brought up to date
 *   POST create  { kind, stake, x, y } -> put up a challenge (soft stake escrowed now)
 *   POST cancel                        -> take an untaken challenge down
 *   POST accept  { id, x, y }          -> take one; the match starts (or waits for stakes)
 *   POST input   { id, type, ... }     -> something the player did, stamped on arrival
 *   GET  inputs?id=&since=             -> the log from that sequence on
 *   POST invoice { id }                -> the on-chain stake payment to sign
 *   POST deposit { id, signature }     -> prove the stake landed in the pool
 *
 * Nothing here takes a position or a hit from a request. The server
 * replays the stamped input log to score, and every stake is in escrow
 * before the first throw.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json, query } from '../_shared.js';
import { BusyError } from '../../src/server/lock.js';
import { gateError } from '../../src/server/access.js';
import { walletForToken } from '../../src/server/game.js';
import { poolReady } from '../../src/server/pool.js';
import {
  acceptChallenge,
  addInput,
  cancelChallenge,
  confirmDeposit,
  createChallenge,
  depositInvoice,
  inputsSince,
  listOpen,
  matchState,
} from '../../src/server/arena.js';
import { DUEL } from '../../shared/duel.js';
import { FIGHT } from '../../shared/fight.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'arena');

  try {
    if (action === 'open') {
      const open = await listOpen();
      return json(res, 200, {
        challenges: open.map((m) => ({
          id: m.id,
          host: { wallet: m.host.wallet, name: m.host.name, color: m.host.color },
          stake: m.stake,
          createdAt: m.createdAt,
        })),
        rules: { ...DUEL, fight: FIGHT },
        realStakes: poolReady(),
      });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });
    const shut = await gateError(wallet);
    if (shut) return json(res, 403, shut);

    if (action === 'state') {
      const result = await matchState(wallet, query(req, 'id') || undefined);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { match: result.match ?? null });
    }

    if (action === 'create') {
      const { kind, stake, x, y } = body(req);
      const result = await createChallenge(wallet, kind, stake, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { id: result.match!.id });
    }

    if (action === 'cancel') {
      const result = await cancelChallenge(wallet);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { ok: true });
    }

    if (action === 'accept') {
      const { id, x, y } = body(req);
      const result = await acceptChallenge(wallet, id, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { id: result.match!.id });
    }

    if (action === 'input') {
      const { id, ...input } = body(req);
      const result = await addInput(wallet, id, input);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'inputs') {
      const result = await inputsSince(wallet, query(req, 'id'), query(req, 'since'));
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'invoice') {
      const result = await depositInvoice(wallet, body(req).id);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'deposit') {
      const { id, signature } = body(req);
      const result = await confirmDeposit(wallet, id, signature);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown arena action.' });
  } catch (err: any) {
    if (err instanceof BusyError) return json(res, 429, { error: err.message });
    return json(res, 500, { error: String(err?.message || err) });
  }
}
