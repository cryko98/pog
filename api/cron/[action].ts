/**
 * The daily close, run by Vercel's cron just after midnight UTC.
 *
 *   GET /api/cron/daily     -> closes yesterday (idempotent) and reports it
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when the env var is
 * set; anything else is refused. The same close also happens lazily from
 * the first season read after midnight, so the cron is belt and braces:
 * a day is closed exactly once whoever gets there first.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CLOSED, actionOf, bearer, closed, json } from '../_shared.js';
import { closeDay, dayRecord, recentDays } from '../../src/server/airdrop.js';
import { dayOf } from '../../shared/season.js';

export default async function handler(req: any, res: any) {
  if (closed()) return json(res, 503, CLOSED);
  if (actionOf(req, 'cron') !== 'daily') return json(res, 404, { error: 'Unknown cron.' });
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret || bearer(req) !== secret) return json(res, 401, { error: 'Not the cron.' });
  try {
    const y = dayOf(Date.now() - 86_400_000);
    const record = (await closeDay(y)) ?? (await dayRecord(y));
    return json(res, 200, { day: y, record, recent: await recentDays(7) });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
