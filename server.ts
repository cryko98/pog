/**
 * Local dev server. On Vercel each `api/<module>/[action].ts` is its own
 * serverless function; here we load the very same handlers on demand so
 * `/api/*` behaves identically under `npm run dev`.
 *
 * Without Upstash credentials the handlers fall back to an in-process store,
 * so you can develop the whole game offline — it just forgets everything when
 * you restart.
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 5173);
const apiDir = path.join(process.cwd(), 'api');
const handlers = new Map<string, (req: unknown, res: unknown) => Promise<unknown>>();

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.all('/api/:mod/:action', async (req, res) => {
  const mod = String(req.params.mod || '');
  if (!/^[a-z0-9_-]+$/i.test(mod)) {
    return res.status(404).json({ error: 'Unknown api module.' });
  }
  const file = path.join(apiDir, mod, '[action].ts');
  if (!existsSync(file)) return res.status(404).json({ error: 'Unknown api module.', mod });

  try {
    let handler = handlers.get(mod);
    if (!handler) {
      const loaded = await import(pathToFileURL(file).href);
      handler = loaded.default;
      if (typeof handler !== 'function') throw new Error('no default export');
      handlers.set(mod, handler);
    }
    // Vercel exposes the dynamic segment as req.query.action
    (req as unknown as { query: Record<string, string> }).query = {
      ...(req.query as Record<string, string>),
      action: req.params.action,
    };
    await handler(req, res);
  } catch (err) {
    console.error(`[api] /api/${mod}/${req.params.action} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
  }
});

// Vite's HMR needs our own http server to upgrade its WebSocket onto,
// otherwise the browser retries a connection that nothing is listening on.
const httpServer = createHttpServer(app);
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { server: httpServer } },
  appType: 'spa',
});
app.use(vite.middlewares);

httpServer.listen(PORT, () => {
  const persistent = !!(
    process.env.POG_KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL
  );
  console.log(`\n  🐧  $POG  →  http://localhost:${PORT}\n`);
  console.log(
    persistent
      ? '  [api] Upstash Redis configured — profiles and $POG persist.'
      : '  [api] No Upstash Redis in .env — using an in-memory store (wiped on restart).'
  );
  console.log('  [world] multiplayer runs over the public MQTT broker, no local server needed.\n');
});
