/**
 * One captcha per wallet per season, as part of qualifying for Frost.
 *
 * Cloudflare Turnstile. It is not a serious defence on its own — solving
 * services are cheap — but it puts a per-wallet cost on spinning up the
 * hundredth account, which is exactly the axis that matters here.
 *
 * Note on the failure mode: when TURNSTILE_SECRET is not configured the
 * requirement is DROPPED from the checklist entirely, rather than being
 * marked as passed. Those look the same from the outside and are not:
 * issuing a "verified" mark nobody earned would leave a permanent record
 * claiming a check happened that never did — and that record would still
 * be there after the secret is finally set.
 */

import { kv } from './kv.js';
import { SEASON } from '../../shared/season.js';

const SECRET = (process.env.TURNSTILE_SECRET || '').trim();
/**
 * The public half of the pair. Served to the client from `/season/config`
 * rather than baked in at build time, so the captcha has exactly one place
 * to be configured.
 *
 * The gate needs BOTH halves. With only the secret set, the requirement
 * would appear on the checklist while the browser had no key to render a
 * challenge with — every player locked out of Frost by a config change
 * that looked complete.
 */
const SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Is the captcha part of the checklist at all? */
export const humanGateOn = () => SECRET.length > 0 && SITE_KEY.length > 0;

/** The site key the browser needs, or '' when the captcha is off. */
export const humanSiteKey = () => (humanGateOn() ? SITE_KEY : '');

const key = (wallet: string) => `pog:human:s${SEASON.id}:${wallet}`;
/** A season is weeks, not months; a generous TTL still expires eventually. */
const TTL = 120 * 24 * 60 * 60;

export async function isVerified(wallet: string): Promise<boolean> {
  if (!humanGateOn()) return false; // nothing to have passed
  const store = await kv();
  return (await store.get<number>(key(wallet))) != null;
}

/**
 * Check a Turnstile token and, if it is good, mark the wallet for the
 * season. Returns an error string on failure so the caller can show it.
 */
export async function verifyHuman(
  wallet: string,
  token: unknown,
  ip?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!humanGateOn()) {
    return { ok: false, error: 'The captcha is not configured on this deploy.' };
  }
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096) {
    return { ok: false, error: 'Missing captcha response.' };
  }

  const body = new URLSearchParams({ secret: SECRET, response: token });
  if (ip) body.set('remoteip', ip);

  let ok = false;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as { success?: boolean };
    ok = json?.success === true;
  } catch {
    return { ok: false, error: 'Could not reach the captcha service. Try again.' };
  }
  if (!ok) return { ok: false, error: 'That captcha did not check out.' };

  const store = await kv();
  await store.set(key(wallet), Date.now(), { ex: TTL });
  return { ok: true };
}
