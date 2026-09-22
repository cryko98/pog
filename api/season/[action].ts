/**
 * The season: Frost, the airdrop ledger, and what it takes to qualify.
 *
 *   GET  config                   -> rules, budget, which gates are live  (public)
 *   GET  status                   -> this wallet's Frost, gate and share
 *   GET  board                    -> the Frost leaderboard with estimates
 *   POST offer  { id, x, y }      -> burn resources at the cairn for Frost
 *   POST verify { token }         -> pass the captcha once per season
 *
 * There is deliberately no endpoint that credits Frost. Frost is only ever
 * written from inside `heartbeat`, `claimQuest`, `buildIgloo` and `offer` —
 * actions the server has already validated on its own terms.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json } from '../_shared.js';
import {
  FROST,
  GATE,
  HOLDER_TIERS,
  IGLOO_BONUS,
  OFFERINGS,
  OFFERING_DAILY_CAP,
  SEASON,
  STREAK,
  seasonState,
} from '../../shared/season.js';
import { chainLive } from '../../src/server/chain.js';
import { humanGateOn, verifyHuman } from '../../src/server/human.js';
import { frostLeaderboard, offerAtCairn, seasonFor, walletForToken } from '../../src/server/game.js';

/** Best-effort client IP, passed to Turnstile as a weak extra signal. */
function clientIp(req: any): string | undefined {
  const raw = String(req.headers?.['x-forwarded-for'] || '');
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'season');

  try {
    // --- public --------------------------------------------------------
    if (action === 'config') {
      return json(res, 200, {
        season: seasonState(),
        budget: SEASON.budget,
        budgetLabel: SEASON.budgetLabel,
        gate: GATE,
        frost: FROST,
        offerings: Object.values(OFFERINGS),
        offeringCap: OFFERING_DAILY_CAP,
        tiers: HOLDER_TIERS,
        streak: STREAK,
        iglooBonus: IGLOO_BONUS,
        /** which optional gates this deploy actually enforces */
        gates: { chain: chainLive(), captcha: humanGateOn() },
      });
    }

    if (action === 'board') {
      return json(res, 200, { entries: await frostLeaderboard(25) });
    }

    const wallet = await walletForToken(bearer(req) || body(req).token);
    if (!wallet) return json(res, 401, { error: 'No valid session.' });

    if (action === 'status') {
      const summary = await seasonFor(wallet);
      if ('error' in summary && summary.error) return json(res, 409, { error: summary.error });
      return json(res, 200, summary);
    }

    if (action === 'offer') {
      const { id, x, y } = body(req);
      const result = await offerAtCairn(wallet, id, x, y);
      if (result.error) return json(res, 409, { error: result.error });
      return json(res, 200, result);
    }

    if (action === 'verify') {
      const result = await verifyHuman(wallet, body(req).token, clientIp(req));
      if (!result.ok) return json(res, 409, { error: result.error });
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Unknown season action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
