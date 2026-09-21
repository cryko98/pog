/**
 * Domain logic for the serverless API: wallet auth, profiles, the $POG
 * economy and the online counter. Pure data access on top of `kv`, shared by
 * every handler in `api/` and by the local dev bridge in `server.ts`.
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { kv } from './kv.js';
import { COIN, getCoins } from '../../shared/world.js';

export const SCARF_COLORS = [
  '#ff6b2c',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#facc15',
  '#f87171',
  '#e2e8f0',
];

const K = {
  nonce: (wallet: string) => `pog:nonce:${wallet}`,
  session: (token: string) => `pog:sess:${token}`,
  profile: (wallet: string) => `pog:wallet:${wallet}`,
  names: 'pog:names', // lowercased name -> wallet
  leaderboard: 'pog:lb', // wallet -> $POG
  coins: 'pog:coins', // coinId -> timestamp it respawns at
  online: 'pog:online', // clientId -> last heartbeat
  rate: (wallet: string) => `pog:rate:${wallet}`,
};

const NONCE_TTL = 5 * 60;
export const SESSION_TTL = 7 * 24 * 60 * 60;
const PROFILE_TTL = 365 * 24 * 60 * 60; // sliding — refreshed on every read
const ONLINE_WINDOW = 35_000;

/** A generous ceiling on coins per wallet per minute; honest play stays far under. */
const CLAIMS_PER_MIN = 40;

export interface Profile {
  wallet: string;
  name: string;
  color: string;
  pog: number;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * Wallet auth (Solana ed25519 over a plain-text message)
 * ------------------------------------------------------------------ */

export function loginMessage(nonce: string): string {
  return [
    'POG — Sign in to the frozen world',
    '',
    'Signing this message proves you own this wallet.',
    'It is free, off-chain, and never moves your funds.',
    '',
    'nonce: ' + nonce,
  ].join('\n');
}

export function isValidWallet(wallet: unknown): wallet is string {
  try {
    return typeof wallet === 'string' && bs58.decode(wallet).length === 32;
  } catch {
    return false;
  }
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function issueNonce(wallet: string): Promise<string> {
  const nonce = randomHex(16);
  const store = await kv();
  await store.set(K.nonce(wallet), nonce, { ex: NONCE_TTL });
  return nonce;
}

/** Verifies the signature against a nonce we issued, then burns the nonce. */
export async function verifyLogin(wallet: string, signatureB58: string): Promise<string | null> {
  const store = await kv();
  const nonce = await store.get<string>(K.nonce(wallet));
  if (!nonce) return null;

  let ok = false;
  try {
    ok = nacl.sign.detached.verify(
      new TextEncoder().encode(loginMessage(nonce)),
      bs58.decode(signatureB58),
      bs58.decode(wallet)
    );
  } catch {
    ok = false;
  }
  if (!ok) return null;

  await store.del(K.nonce(wallet));
  const token = randomHex(32);
  await store.set(K.session(token), wallet, { ex: SESSION_TTL });
  return token;
}

export async function walletForToken(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 16) return null;
  const store = await kv();
  return (await store.get<string>(K.session(token))) ?? null;
}

export async function dropSession(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  (await kv()).del(K.session(token));
}

/* ------------------------------------------------------------------ *
 * Profiles
 * ------------------------------------------------------------------ */

const NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_ .-]{1,15}$/;

export function validateName(raw: unknown): { name?: string; error?: string } {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) {
    return { error: 'Names are 2-16 characters: letters, numbers, _ . - and spaces.' };
  }
  return { name };
}

export async function getProfile(wallet: string): Promise<Profile | null> {
  const store = await kv();
  const p = await store.get<Profile>(K.profile(wallet));
  if (!p) return null;
  await store.set(K.profile(wallet), p, { ex: PROFILE_TTL }); // sliding expiry
  return p;
}

export async function nameOwner(name: string): Promise<string | null> {
  const store = await kv();
  return (await store.hget<string>(K.names, name.toLowerCase())) ?? null;
}

export async function saveProfile(
  wallet: string,
  name: string,
  color: string
): Promise<{ profile?: Profile; error?: string }> {
  const store = await kv();

  const owner = await nameOwner(name);
  if (owner && owner !== wallet) return { error: 'That name is already taken.' };

  const existing = await store.get<Profile>(K.profile(wallet));
  const now = Date.now();
  const profile: Profile = {
    wallet,
    name,
    color: SCARF_COLORS.includes(color) ? color : SCARF_COLORS[0],
    pog: existing?.pog ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // release the previous name so it becomes available again
  if (existing?.name && existing.name.toLowerCase() !== name.toLowerCase()) {
    await store.hdel(K.names, existing.name.toLowerCase());
  }

  await store.hset(K.names, name.toLowerCase(), wallet);
  await store.set(K.profile(wallet), profile, { ex: PROFILE_TTL });
  await store.zadd(K.leaderboard, profile.pog, wallet);
  return { profile };
}

/* ------------------------------------------------------------------ *
 * $POG pickups
 * ------------------------------------------------------------------ */

/** Coin ids currently held by somebody, so a joining client hides them too. */
export async function takenCoins(): Promise<number[]> {
  const store = await kv();
  const now = Date.now();
  await store.zremRangeByScore(K.coins, 0, now);
  const ids = await store.zrangeByScore(K.coins, now, Number.MAX_SAFE_INTEGER);
  return ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
}

export async function claimCoin(
  wallet: string,
  coinId: number
): Promise<{ pog?: number; error?: string }> {
  const coins = getCoins() as Array<{ id: number }>;
  if (!Number.isInteger(coinId) || coinId < 0 || coinId >= coins.length) {
    return { error: 'No such coin.' };
  }

  const store = await kv();

  // rate limit before touching anything else
  const hits = await store.incrWithTtl(K.rate(wallet), 60);
  if (hits > CLAIMS_PER_MIN) return { error: 'Slow down.' };

  const now = Date.now();
  await store.zremRangeByScore(K.coins, 0, now);
  const won = await store.zaddnx(K.coins, now + COIN.respawnMs, String(coinId));
  if (!won) return { error: 'Someone else grabbed it.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  profile.pog += COIN.value;
  profile.updatedAt = now;
  await store.set(K.profile(wallet), profile, { ex: PROFILE_TTL });
  await store.zadd(K.leaderboard, profile.pog, wallet);
  return { pog: profile.pog };
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  color: string;
  pog: number;
}

export async function leaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  const store = await kv();
  const top = await store.ztop(K.leaderboard, limit);
  if (!top.length) return [];

  const profiles = await store.mget<Profile>(top.map((t) => K.profile(t.member)));
  return top
    .map((t, i) => ({ t, p: profiles[i] }))
    .filter(({ p }) => !!p?.name)
    .map(({ t, p }, i) => ({
      rank: i + 1,
      name: p!.name,
      color: p!.color,
      pog: Math.round(t.score),
    }));
}

/* ------------------------------------------------------------------ *
 * Online counter
 *
 * A server-side backstop for the MQTT presence count, which can dip when the
 * public broker hiccups or a client is mid-reconnect. The UI shows whichever
 * number is higher.
 * ------------------------------------------------------------------ */

export async function heartbeat(clientId: string): Promise<number> {
  const store = await kv();
  const now = Date.now();
  await store.zadd(K.online, now, clientId.slice(0, 64));
  await store.zremRangeByScore(K.online, 0, now - ONLINE_WINDOW);
  return store.zcard(K.online);
}

export async function onlineCount(): Promise<number> {
  const store = await kv();
  const now = Date.now();
  await store.zremRangeByScore(K.online, 0, now - ONLINE_WINDOW);
  return store.zcard(K.online);
}

export async function walletCount(): Promise<number> {
  const store = await kv();
  return store.zcard(K.leaderboard);
}
