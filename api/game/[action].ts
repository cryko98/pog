/**
 * The survival layer: gathering, crafting, igloos and the skin shop.
 * Everything here needs a wallet session — guests can roam, but nothing
 * they do is recorded.
 *
 *   GET  state                                 -> { profile, depleted, igloos, quests }
 *   POST gather { node, x, y }                 -> { profile, gained, respawnAt }
 *   POST craft  { recipe }                     -> { profile }
 *   GET  quests                                -> { day, quests, streak, ... }
 *   POST quest  { id }                         -> { profile, reward, bonus }
 *   POST build  { x, y, style }                -> { igloo, profile }
 *   POST buy    { skin }                       -> { profile }
 *   POST equip  { skin }                       -> { profile }
 *   GET  igloos                                -> { igloos }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json } from '../_shared.js';
import { RECIPES, SKINS } from '../../shared/world.js';
import {
  buildIgloo,
  buySkin,
  claimQuest,
  craft,
  depletedNodes,
  equipSkin,
  gather,
  getProfile,
  listIgloos,
  questBoard,
  walletForToken,
} from '../../src/server/game.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'game');

  try {
    // --- public --------------------------------------------------------
    if (action === 'igloos') {
      return json(res, 200, { igloos: await listIgloos() });
    }
    if (action === 'catalogue') {
      return json(res, 200, { skins: SKINS, recipes: Object.values(RECIPES) });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });

    if (action === 'state') {
      const [profile, depleted, igloos, quests] = await Promise.all([
        getProfile(wallet),
        depletedNodes(),
        listIgloos(),
        questBoard(wallet),
      ]);
      return json(res, 200, { profile, depleted, igloos, quests });
    }

    if (action === 'quests') {
      return json(res, 200, await questBoard(wallet));
    }

    if (action === 'quest') {
      const result = await claimQuest(wallet, body(req).id);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'gather') {
      const { node, x, y } = body(req);
      const result = await gather(wallet, node, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'craft') {
      const result = await craft(wallet, body(req).recipe);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'build') {
      const { x, y, style } = body(req);
      const result = await buildIgloo(wallet, x, y, style);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'buy') {
      const result = await buySkin(wallet, body(req).skin);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'equip') {
      const result = await equipSkin(wallet, body(req).skin);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Unknown game action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
