export interface Profile {
  wallet: string;
  name: string;
  color: string;
  pog: number;
  wood: number;
  ice: number;
  fish: number;
  items: Record<string, number>;
  skins: string[];
  skin: string;
  playMinutes: number;
  skills?: Record<string, number>;
  /** every species landed, by count */
  fishLog?: Record<string, number>;
  streak?: number;
  lastQuestDay?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface QuestView {
  id: string;
  label: string;
  icon: string;
  reward: number;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface QuestBoard {
  day: string;
  quests: QuestView[];
  streak: number;
  streakBonus: number;
  claimable: number;
}

/* --- the season / Frost ledger --- */

export interface SeasonWindow {
  id: number;
  name: string;
  open: boolean;
  before: boolean;
  over: boolean;
  daysLeft: number;
  dayNumber: number;
  totalDays: number;
}

export interface GateItem {
  id: string;
  label: string;
  done: boolean;
  have?: number;
  need?: number;
}

export interface SeasonStatus {
  season: SeasonWindow;
  budget: number;
  budgetLabel: string;
  frost: number;
  frostToday: number;
  dailyCap: number;
  offerToday: number;
  offerCap: number;
  streak: number;
  multipliers: {
    streak: { add: number; days: number };
    igloo: { add: number; has: boolean };
    holder: { add: number; label: string; balance: number };
    total: number;
  };
  pool: number;
  rank: number | null;
  share: number;
  tokens: number;
  gate: { ok: boolean; items: GateItem[] };
}

export interface FrostEntry {
  rank: number;
  name: string;
  color: string;
  frost: number;
  tokens: number;
}

export interface Offering {
  id: string;
  label: string;
  cost: Record<string, number>;
  frost: number;
}

export interface FurniturePiece {
  id: string;
  x: number;
  y: number;
}

export interface Igloo {
  wallet: string;
  owner: string;
  x: number;
  y: number;
  style: string;
  builtAt: number;
  furniture?: FurniturePiece[];
  lastYield?: number;
}

export interface Furnishing {
  id: string;
  label: string;
  blurb: string;
  price: number;
  value: number;
  r: number;
}

export type ListingCurrency = 'soft' | 'pog';

export interface IglooListing {
  wallet: string;
  seller: string;
  price: number;
  /** in-game $POG, or the real token paid on chain */
  currency: ListingCurrency;
  level: number;
  levelLabel: string;
  pieces: number;
  style: string;
  listedAt: number;
}

export interface HomeState {
  igloo: Igloo | null;
  level: { level: number; label: string; value: number; daily: number; next: { level: number; label: string; needs: number; daily: number } | null };
  pieces: FurniturePiece[];
  limit: number;
  listed: boolean;
  /** a buyer is mid-payment on your on-chain listing */
  reserved: boolean;
  pending: number;
  collected: number;
  catalogue: Furnishing[];
  market: IglooListing[];
  fee: number;
  /** the on-chain market: open once the token is live */
  chain: { live: boolean; fee: number; min: number; max: number };
  profile: Profile | null;
}

export interface SaleReservation {
  buyer: string;
  seller: string;
  listedAt: number;
  price: number;
  expiresAt: number;
}

export interface SaleInvoice {
  /** base64, unsigned — the wallet shows what it does before signing */
  transaction: string;
  price: number;
  takeHome: number;
  burn: number;
  decimals: number;
  memo: string;
  expiresAt: number;
  lastValidBlockHeight: number;
}

export interface SaleRecord {
  seller: string;
  buyer: string;
  price: number;
  burn: number;
  signature: string;
  listedAt: number;
  at: number;
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

  claimCoin: (id: number, x: number, y: number) =>
    request<{ pog: number }>('/world/claim', post({ id, x: Math.round(x), y: Math.round(y) })),

  beat: (id: string) => request<{ count: number }>('/online/beat', post({ id })),

  /* --- survival layer --- */

  gameState: () =>
    request<{ profile: Profile; depleted: string[]; igloos: Igloo[]; quests: QuestBoard }>(
      '/game/state'
    ),

  quests: () => request<QuestBoard>('/game/quests'),

  claimQuest: (id: string) =>
    request<{ profile: Profile; reward: number; bonus: number; streak: number }>(
      '/game/quest',
      post({ id })
    ),

  /**
   * One swing. The profile, yield and respawn only come back on the blow
   * that finally fells the node; before that it reports progress.
   */
  gather: (node: string, x: number, y: number) =>
    request<{
      hits?: number;
      needed?: number;
      profile?: Profile;
      gained?: Record<string, number>;
      respawnAt?: number;
      /** fishing: what bit, or that it got away */
      catch?: { id: string; label: string; rarity: string };
      escaped?: boolean;
    }>('/game/gather', post({ node, x: Math.round(x), y: Math.round(y) })),

  craft: (recipe: string) => request<{ profile: Profile }>('/game/craft', post({ recipe })),

  buildIgloo: (x: number, y: number, style: string) =>
    request<{ igloo: Igloo; profile: Profile }>(
      '/game/build',
      post({ x: Math.round(x), y: Math.round(y), style })
    ),

  igloos: () => request<{ igloos: Igloo[] }>('/game/igloos'),

  /* --- season --- */

  seasonConfig: () =>
    request<{
      season: SeasonWindow;
      budgetLabel: string;
      offerings: Offering[];
      gates: { chain: boolean; captcha: boolean };
      captchaSiteKey: string;
    }>('/season/config'),

  verifyHuman: (token: string) => request<{ ok: boolean }>('/season/verify', post({ token })),

  season: () => request<SeasonStatus>('/season/status'),

  frostBoard: () => request<{ entries: FrostEntry[] }>('/season/board'),

  offer: (id: string, x: number, y: number) =>
    request<{ profile: Profile; frost: number; spent: Record<string, number> }>(
      '/season/offer',
      post({ id, x: Math.round(x), y: Math.round(y) })
    ),

  /* --- home: furnishing, levels and the igloo market --- */

  home: () => request<HomeState>('/home/state'),

  buyFurniture: (id: string, qty = 1) =>
    request<{ profile: Profile }>('/home/buy', post({ id, qty })),

  placeFurniture: (id: string, x: number, y: number) =>
    request<{ igloo: Igloo; profile: Profile }>(
      '/home/place',
      post({ id, x: Math.round(x), y: Math.round(y) })
    ),

  removeFurniture: (index: number) =>
    request<{ igloo: Igloo; profile: Profile }>('/home/remove', post({ index })),

  listIgloo: (price: number, currency: ListingCurrency = 'soft') =>
    request<{ listing: IglooListing }>('/home/list', post({ price, currency })),

  unlistIgloo: () => request<{ ok: boolean }>('/home/unlist', post()),

  purchaseIgloo: (seller: string) =>
    request<{ igloo: Igloo; profile: Profile; paid: number; burned: number }>(
      '/home/purchase',
      post({ seller })
    ),

  /* --- the on-chain market: reserve, sign the payment, settle --- */

  reserveSale: (seller: string) =>
    request<{ reservation: SaleReservation }>('/home/reserve', post({ seller })),

  saleInvoice: (seller: string) => request<{ invoice: SaleInvoice }>('/home/invoice', post({ seller })),

  settleSale: (seller: string, signature: string) =>
    request<{ igloo?: Igloo; pending?: boolean }>('/home/settle', post({ seller, signature })),

  recentSales: () => request<{ sales: SaleRecord[] }>('/home/sales'),

  buySkin: (skin: string) => request<{ profile: Profile }>('/game/buy', post({ skin })),

  equipSkin: (skin: string) => request<{ profile: Profile }>('/game/equip', post({ skin })),
};
