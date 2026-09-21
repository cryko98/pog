/**
 * Per-wallet cloud save: username, scarf colour and banked $POG. Keyed by
 * wallet address, so a player's penguin follows them to any browser.
 *
 *   GET  me            (Bearer token)   -> { wallet, profile }
 *   POST set { name, color }            -> { profile }
 *   GET  namecheck?name=<name>          -> { ok, reason? }
 *   GET  leaderboard                    -> { entries }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json, query } from '../_shared.js';
import {
  getProfile,
  leaderboard,
  nameOwner,
  saveProfile,
  validateName,
  walletForToken,
} from '../../src/server/game.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'profile');

  try {
    if (action === 'leaderboard') {
      return json(res, 200, { entries: await leaderboard(25) });
    }

    if (action === 'namecheck') {
      const { name, error } = validateName(query(req, 'name'));
      if (error) return json(res, 200, { ok: false, reason: error });
      const owner = await nameOwner(name!);
      const me = await walletForToken(bearer(req));
      if (owner && owner !== me) return json(res, 200, { ok: false, reason: 'That name is already taken.' });
      return json(res, 200, { ok: true });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session — connect your wallet again.' });

    if (action === 'me') {
      return json(res, 200, { wallet, profile: await getProfile(wallet) });
    }

    if (action === 'set') {
      const { name, error } = validateName(body(req).name);
      if (error) return json(res, 400, { error });
      const result = await saveProfile(wallet, name!, String(body(req).color || ''));
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, { profile: result.profile });
    }

    return json(res, 404, { error: 'Unknown profile action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
