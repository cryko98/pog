// $POG realtime server: wallet auth over HTTP, world state over WebSocket.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import { WORLD, PLAYER, COIN, getCoins, resolveCollisions } from '../../shared/world.js';
import {
  getProfile,
  upsertProfile,
  addPog,
  nameTaken,
  leaderboard,
  createSession,
  resolveSession,
  dropSession,
  stats,
} from './store.js';

const PORT = Number(process.env.PORT || 8787);
const TICK_HZ = 12;
const CLIENT_DIST = path.resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));

export const COLORS = ['#ff6b2c', '#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#f87171', '#e2e8f0'];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ .-]{1,15}$/;

function validateName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) {
    return { error: 'Names are 2-16 characters: letters, numbers, _ . - and spaces.' };
  }
  return { name };
}

function isValidWallet(wallet) {
  try {
    return bs58.decode(String(wallet)).length === 32;
  } catch {
    return false;
  }
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * Wallet auth: nonce -> signMessage -> bearer token
 * ------------------------------------------------------------------ */

const nonces = new Map(); // wallet -> { nonce, exp }
const NONCE_TTL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [wallet, entry] of nonces) if (entry.exp < now) nonces.delete(wallet);
}, 60_000).unref();

export function loginMessage(nonce) {
  return [
    'POG — Sign in to the frozen world',
    '',
    'Signing this message proves you own this wallet.',
    'It is free, off-chain, and never moves your funds.',
    '',
    'nonce: ' + nonce,
  ].join('\n');
}

function verifySignature(wallet, signatureB58, nonce) {
  try {
    const message = new TextEncoder().encode(loginMessage(nonce));
    return nacl.sign.detached.verify(message, bs58.decode(signatureB58), bs58.decode(wallet));
  } catch {
    return false;
  }
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/* ------------------------------------------------------------------ *
 * HTTP API + static client
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(CLIENT_DIST)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('POG server running. Build the client with `npm run build`, or use the Vite dev server.');
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.join(CLIENT_DIST, rel);
  if (!file.startsWith(CLIENT_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(CLIENT_DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const { pathname } = url;

  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  try {
    // --- handshake ---------------------------------------------------
    if (pathname === '/api/nonce' && req.method === 'GET') {
      const wallet = url.searchParams.get('wallet') || '';
      if (!isValidWallet(wallet)) return json(res, 400, { error: 'Invalid wallet address.' });
      const nonce = crypto.randomBytes(16).toString('hex');
      nonces.set(wallet, { nonce, exp: Date.now() + NONCE_TTL });
      return json(res, 200, { nonce, message: loginMessage(nonce) });
    }

    if (pathname === '/api/auth' && req.method === 'POST') {
      const { wallet, signature } = await readBody(req);
      const entry = nonces.get(wallet);
      if (!isValidWallet(wallet) || !entry || entry.exp < Date.now()) {
        return json(res, 400, { error: 'Nonce expired or missing — please try again.' });
      }
      if (!verifySignature(wallet, signature, entry.nonce)) {
        return json(res, 401, { error: 'That signature is not valid.' });
      }
      nonces.delete(wallet);

      const token = crypto.randomBytes(32).toString('hex');
      createSession(token, wallet);
      const profile = getProfile(wallet);
      return json(res, 200, { token, wallet, profile });
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      dropSession(bearer(req));
      return json(res, 200, { ok: true });
    }

    // --- profile -----------------------------------------------------
    if (pathname === '/api/profile' && req.method === 'GET') {
      const wallet = resolveSession(bearer(req));
      if (!wallet) return json(res, 401, { error: 'No valid session.' });
      return json(res, 200, { wallet, profile: getProfile(wallet) });
    }

    if (pathname === '/api/profile' && req.method === 'POST') {
      const wallet = resolveSession(bearer(req));
      if (!wallet) return json(res, 401, { error: 'No valid session.' });

      const body = await readBody(req);
      const { name, error } = validateName(body.name);
      if (error) return json(res, 400, { error });
      if (nameTaken(name, wallet)) return json(res, 409, { error: 'That name is already taken.' });

      const color = COLORS.includes(body.color) ? body.color : COLORS[0];
      const profile = upsertProfile(wallet, { name, color });

      // live-update the name tag if this wallet is already in the world
      for (const p of players.values()) {
        if (p.wallet === wallet) {
          p.name = name;
          p.color = color;
          broadcast({ t: 'profile', id: p.id, name, color });
        }
      }
      return json(res, 200, { profile });
    }

    if (pathname === '/api/name-check' && req.method === 'GET') {
      const candidate = validateName(url.searchParams.get('name'));
      if (candidate.error) return json(res, 200, { ok: false, reason: candidate.error });
      const wallet = resolveSession(bearer(req));
      if (nameTaken(candidate.name, wallet)) {
        return json(res, 200, { ok: false, reason: 'That name is already taken.' });
      }
      return json(res, 200, { ok: true });
    }

    // --- public ------------------------------------------------------
    if (pathname === '/api/leaderboard') return json(res, 200, { entries: leaderboard(25) });
    if (pathname === '/api/stats') {
      return json(res, 200, { online: players.size, ...stats() });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    return json(res, 400, { error: err.message || 'Bad request.' });
  }
});

/* ------------------------------------------------------------------ *
 * Realtime world
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

/** id -> player */
const players = new Map();
/** coinId -> timestamp when it comes back */
const takenCoins = new Map();
let nextId = 1;

const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function broadcast(msg, exceptId) {
  const payload = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(payload);
  }
}

const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  color: p.color,
  wallet: p.wallet.slice(0, 4) + '…' + p.wallet.slice(-4),
  x: Math.round(p.x),
  y: Math.round(p.y),
  dir: p.dir,
  moving: p.moving,
  pog: p.pog,
});

function spawnPoint() {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * (WORLD.spawnRadius - 90);
  return {
    x: WORLD.spawn.x + Math.cos(angle) * dist,
    y: WORLD.spawn.y + Math.sin(angle) * dist * 0.75,
  };
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    /* ---- join ---- */
    if (msg.t === 'join') {
      if (player) return;
      const wallet = resolveSession(msg.token);
      if (!wallet) return send(ws, { t: 'error', code: 'auth', message: 'Please sign in with your wallet again.' });

      const profile = getProfile(wallet);
      if (!profile || !profile.name) {
        return send(ws, { t: 'error', code: 'noprofile', message: 'Pick a username first.' });
      }

      // one live penguin per wallet
      for (const other of players.values()) {
        if (other.wallet === wallet) {
          send(other.ws, { t: 'error', code: 'kicked', message: 'This wallet joined from another tab or device.' });
          other.ws.close();
        }
      }

      const { x, y } = spawnPoint();
      player = {
        id: nextId++,
        ws,
        wallet,
        name: profile.name,
        color: profile.color || COLORS[0],
        x,
        y,
        dir: 'down',
        moving: false,
        pog: profile.pog || 0,
        lastMoveAt: Date.now(),
        lastChatAt: 0,
      };
      players.set(player.id, player);

      send(ws, {
        t: 'welcome',
        id: player.id,
        seed: WORLD.seed,
        you: publicPlayer(player),
        players: [...players.values()].filter((p) => p.id !== player.id).map(publicPlayer),
        takenCoins: [...takenCoins.keys()],
      });
      broadcast({ t: 'spawn', player: publicPlayer(player) }, player.id);
      broadcast({ t: 'system', message: player.name + ' stepped onto the ice.' }, player.id);
      return;
    }

    if (!player) return;

    /* ---- movement ---- */
    if (msg.t === 'move') {
      const now = Date.now();
      const dt = Math.min(0.5, (now - player.lastMoveAt) / 1000) || 0.05;
      player.lastMoveAt = now;

      const nx = Number(msg.x);
      const ny = Number(msg.y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

      // speed clamp: accept the client position only if it was reachable
      const maxStep = PLAYER.maxSpeed * dt + 24;
      const dist = Math.hypot(nx - player.x, ny - player.y);
      let tx = nx;
      let ty = ny;
      if (dist > maxStep) {
        const k = maxStep / dist;
        tx = player.x + (nx - player.x) * k;
        ty = player.y + (ny - player.y) * k;
      }

      const fixed = resolveCollisions(tx, ty);
      player.x = fixed.x;
      player.y = fixed.y;
      player.dir = ['up', 'down', 'left', 'right'].includes(msg.dir) ? msg.dir : player.dir;
      player.moving = !!msg.moving;
      return;
    }

    /* ---- coin pickup ---- */
    if (msg.t === 'pickup') {
      const coin = getCoins()[msg.id | 0];
      if (!coin) return;
      if (takenCoins.has(coin.id)) return;
      if (Math.hypot(player.x - coin.x, player.y - coin.y) > COIN.pickupRadius * 1.8) return;

      takenCoins.set(coin.id, Date.now() + COIN.respawnMs);
      player.pog = addPog(player.wallet, COIN.value);
      send(ws, { t: 'pog', pog: player.pog, coin: coin.id });
      broadcast({ t: 'coin', id: coin.id, taken: true });
      return;
    }

    /* ---- chat ---- */
    if (msg.t === 'chat') {
      const now = Date.now();
      if (now - player.lastChatAt < 700) return;
      player.lastChatAt = now;
      const text = String(msg.text || '').slice(0, 140).trim();
      if (!text) return;
      // the sender already echoed it locally, so skip them
      broadcast({ t: 'chat', id: player.id, name: player.name, color: player.color, text }, player.id);
      return;
    }
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    broadcast({ t: 'despawn', id: player.id });
    broadcast({ t: 'system', message: player.name + ' left the ice.' });
  });
});

// drop half-open sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

// world snapshot
setInterval(() => {
  if (players.size === 0) return;
  const snapshot = [...players.values()].map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.dir, p.moving ? 1 : 0]);
  broadcast({ t: 'state', ts: Date.now(), players: snapshot });
}, 1000 / TICK_HZ).unref();

// coin respawn
setInterval(() => {
  const now = Date.now();
  for (const [id, at] of takenCoins) {
    if (at <= now) {
      takenCoins.delete(id);
      broadcast({ t: 'coin', id, taken: false });
    }
  }
}, 1000).unref();

server.listen(PORT, () => {
  console.log('[pog] server on http://localhost:' + PORT + '  (ws: /ws)');
  console.log('[pog] world seed ' + WORLD.seed + ', ' + getCoins().length + ' $POG pickups');
});
