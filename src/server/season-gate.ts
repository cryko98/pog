/**
 * "Has this wallet qualified for the season?", on its own.
 *
 * The full checklist lives in `season.ts` and the inputs it needs — the
 * on-chain balance, the captcha mark, the profile — are gathered in
 * `game.ts`. The market needs the same answer, and importing `game.ts`
 * from `home.ts` for it while `home.ts` is already imported by the API
 * would make that cycle harder to follow than it is worth.
 *
 * So this is the one place that answers the question, and both callers
 * use it.
 */

import { holdingOf } from './chain.js';
import { humanGateOn, isVerified } from './human.js';
import { eligibility, rollover } from './season.js';
import { getProfile } from './game.js';

export async function qualified(wallet: string): Promise<{ ok: boolean; missing: string }> {
  const profile = await getProfile(wallet);
  if (!profile) return { ok: false, missing: 'pick a username first' };

  rollover(profile);
  const [holding, human] = await Promise.all([holdingOf(wallet), isVerified(wallet)]);

  const check = eligibility({
    playMinutes: profile.playMinutes,
    playToday: profile.playToday,
    balance: holding.balance,
    chainLive: holding.live,
    humanRequired: humanGateOn(),
    humanVerified: human,
  });

  const missing = check.items.find((i) => !i.done);
  return { ok: check.ok, missing: missing ? missing.label.toLowerCase() : '' };
}
