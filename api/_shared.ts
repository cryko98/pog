/**
 * Helpers shared by the API handlers. Vercel treats every file under `api/`
 * as a function, but ignores ones whose name starts with `_`, so this is
 * never routable on its own.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Pull the `[action]` segment out of the URL (or the query, as Vercel sets it). */
export function actionOf(req: any, moduleName: string): string {
  const parts = String(req.url || '').split('?')[0].split('/').filter(Boolean);
  const i = parts.indexOf(moduleName);
  let fromPath = '';
  try {
    fromPath = i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : '';
  } catch {
    fromPath = ''; // a malformed %-escape is a 404, not a crash
  }
  return fromPath || (typeof req.query?.action === 'string' ? req.query.action : '');
}

export function body(req: any): Record<string, any> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export function query(req: any, name: string): string {
  const raw = String(req.url || '');
  const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  const fromUrl = new URLSearchParams(qs).get(name);
  if (fromUrl != null) return fromUrl;
  const q = req.query?.[name];
  return typeof q === 'string' ? q : '';
}

export function bearer(req: any): string {
  const header = String(req.headers?.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function json(res: any, code: number, payload: unknown) {
  res.setHeader('cache-control', 'no-store');
  return res.status(code).json(payload);
}

/**
 * The kill switch. With POG_CLOSED set in the environment every handler
 * answers 503 before touching Redis, the chain or anything else, so a
 * closed project costs nothing to leave deployed. Unset it (and redeploy)
 * to open the ice again.
 */
export const closed = () => /^(1|true|yes|on)$/i.test(String(process.env.POG_CLOSED || '').trim());
export const CLOSED = { error: 'The ice has closed — this project has ended.', closed: true };
