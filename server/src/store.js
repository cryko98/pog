// Flat-file persistence. Small enough for launch traffic; swap the four
// functions below for Postgres/Redis when the lobby outgrows one process.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(fileURLToPath(new URL('../data', import.meta.url)));

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  } catch {
    return fallback;
  }
}

fs.mkdirSync(dataDir, { recursive: true });

const profiles = load('profiles.json', {}); // wallet -> profile
const sessions = load('sessions.json', {}); // token -> { wallet, exp }

let dirty = false;
const flush = () => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(path.join(dataDir, 'profiles.json'), JSON.stringify(profiles));
    fs.writeFileSync(path.join(dataDir, 'sessions.json'), JSON.stringify(sessions));
  } catch (err) {
    console.error('[store] write failed', err.message);
  }
};
setInterval(flush, 4000).unref();
process.on('exit', flush);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flush();
    process.exit(0);
  });
}

const touch = () => {
  dirty = true;
};

export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export function getProfile(wallet) {
  return profiles[wallet] || null;
}

export function upsertProfile(wallet, patch) {
  const now = Date.now();
  const existing = profiles[wallet] || { wallet, pog: 0, createdAt: now };
  profiles[wallet] = { ...existing, ...patch, wallet, updatedAt: now };
  touch();
  return profiles[wallet];
}

export function addPog(wallet, amount) {
  const p = profiles[wallet];
  if (!p) return 0;
  p.pog = (p.pog || 0) + amount;
  p.updatedAt = Date.now();
  touch();
  return p.pog;
}

/** Case-insensitive uniqueness so nobody can impersonate a known holder. */
export function nameTaken(name, exceptWallet) {
  const lower = name.toLowerCase();
  return Object.values(profiles).some(
    (p) => p.wallet !== exceptWallet && String(p.name || '').toLowerCase() === lower
  );
}

export function leaderboard(limit = 25) {
  return Object.values(profiles)
    .filter((p) => p.name)
    .sort((a, b) => (b.pog || 0) - (a.pog || 0))
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, name: p.name, color: p.color, pog: p.pog || 0 }));
}

export function createSession(token, wallet) {
  sessions[token] = { wallet, exp: Date.now() + SESSION_TTL };
  touch();
}

export function resolveSession(token) {
  const s = sessions[token];
  if (!s) return null;
  if (s.exp < Date.now()) {
    delete sessions[token];
    touch();
    return null;
  }
  return s.wallet;
}

export function dropSession(token) {
  if (sessions[token]) {
    delete sessions[token];
    touch();
  }
}

export function stats() {
  return { wallets: Object.keys(profiles).length };
}
