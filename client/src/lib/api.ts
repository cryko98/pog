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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error (${res.status})`);
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
