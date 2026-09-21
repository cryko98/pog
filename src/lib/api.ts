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

/** Thrown when the API cannot be reached at all. */
export class ServerDownError extends Error {
  constructor() {
    super('Cannot reach the $POG API. Check your connection and try again.');
    this.name = 'ServerDownError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();

  let res: Response;
  try {
    res = await fetch('/api' + path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ServerDownError();
  }

  const data = await res.json().catch(() => null);

  // Every endpoint answers with JSON. Anything else means we did not reach the
  // API at all — a dev server serving index.html, a proxy error page, a CDN
  // placeholder — and returning null here would crash the caller instead.
  if (data === null) throw new ServerDownError();

  if (!res.ok) {
    const msg = (data as { error?: string }).error;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}

const post = (payload?: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(payload ?? {}) });

export const api = {
  nonce: (wallet: string) => request<{ message: string }>(`/auth/nonce?wallet=${wallet}`),

  verify: (wallet: string, signature: string) =>
    request<{ token: string; wallet: string; profile: Profile | null }>(
      '/auth/verify',
      post({ wallet, signature })
    ),

  logout: () => request<{ ok: boolean }>('/auth/logout', post()).catch(() => ({ ok: false })),

  me: () => request<{ wallet: string; profile: Profile | null }>('/profile/me'),

  saveProfile: (name: string, color: string) =>
    request<{ profile: Profile }>('/profile/set', post({ name, color })),

  checkName: (name: string) =>
    request<{ ok: boolean; reason?: string }>(`/profile/namecheck?name=${encodeURIComponent(name)}`),

  leaderboard: () => request<{ entries: LeaderboardEntry[] }>('/profile/leaderboard'),

  stats: () =>
    request<{ online: number; wallets: number; coins: number; persistent: boolean }>('/world/stats'),

  takenCoins: () => request<{ taken: number[] }>('/world/coins'),

  claimCoin: (id: number) => request<{ pog: number }>('/world/claim', post({ id })),

  beat: (id: string) => request<{ count: number }>('/online/beat', post({ id })),
};
