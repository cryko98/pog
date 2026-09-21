export interface Profile {
  wallet: string;
  name: string;
  color: string;
  pog: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  color: string;
  pog: number;
}

const TOKEN_KEY = 'pog.token';
const WALLET_KEY = 'pog.wallet';

export const storedToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const storedWallet = () => localStorage.getItem(WALLET_KEY) || '';

export function saveSession(token: string, wallet: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(WALLET_KEY, wallet);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(WALLET_KEY);
}

/** Thrown when the game server cannot be reached at all. */
export class ServerDownError extends Error {
  constructor() {
    super(
      `Cannot reach the game server at ${location.origin}. ` +
        'Make sure it is running (npm run dev, or npm start for a build).'
    );
    this.name = 'ServerDownError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    // DNS/connection refused/CORS — the API never answered
    throw new ServerDownError();
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    // a non-JSON body means we hit something that is not our API
    if (!msg && !data) throw new ServerDownError();
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  nonce: (wallet: string) => request<{ nonce: string; message: string }>(`/api/nonce?wallet=${wallet}`),

  auth: (wallet: string, signature: string) =>
    request<{ token: string; wallet: string; profile: Profile | null }>('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ wallet, signature }),
    }),

  me: () => request<{ wallet: string; profile: Profile | null }>('/api/profile'),

  saveProfile: (name: string, color: string) =>
    request<{ profile: Profile }>('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),

  checkName: (name: string) =>
    request<{ ok: boolean; reason?: string }>(`/api/name-check?name=${encodeURIComponent(name)}`),

  leaderboard: () => request<{ entries: LeaderboardEntry[] }>('/api/leaderboard'),

  stats: () => request<{ online: number; wallets: number }>('/api/stats'),

  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }).catch(() => ({ ok: false })),
};
