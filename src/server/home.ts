/**
 * Furnishing an igloo, the level it earns, the $POG it pays, and the
 * market where a furnished one changes hands.
 *
 * ------------------------------------------------------------------ *
 * What this deliberately does not do
 * ------------------------------------------------------------------ *
 *
 * It never writes Frost, a streak, or playtime. An igloo that paid the
 * airdrop ledger would be passive income toward the drop — buy ten on ten
 * wallets and farm the season without playing — which is the exact thing
 * the qualifying gate exists to stop. The yield here is soft $POG.
 *
 * A market is also the natural laundering route for a sybil farm: many
 * shallow wallets selling to one deep one. So both sides of a sale must
 * have passed the Frost gate, and the house takes a cut that is burned
 * rather than paid to anyone, which puts a real price on a wash trade.
 *
 * Listings come in two currencies. `soft` settles here, in in-game $POG.
 * `pog` settles on chain, in the real token, through `sale.ts` — this file
 * only refuses to touch such a listing while a buyer holds it.
 *
 * Every write runs under the owner's wallet lock (see `lock.ts`), because
 * every one of them is read-modify-write and two at once lose an update.
 */

import { kv } from './kv.js';
import { withWallet, withWallets } from './lock.js';
import { chainLive } from './chain.js';
import {
  FURNITURE,
  FURNITURE_LIMIT,
  canPlaceFurniture,
  furnitureById,
  iglooLevel,
  settleYieldAt,
  yieldOwed,
} from '../../shared/world.js';
import { SALE_FEE, SALE_MAX, SALE_MIN } from '../../shared/sale.js';
import { K, getProfile, putProfile, type Igloo, type Profile } from './game.js';
import { isReserved, reservationOf } from './sale.js';

/** Taken out of every soft sale and burned — the cost of a wash trade. */
export const MARKET_FEE = 0.08;
export const PRICE_MIN = 5;
export const PRICE_MAX = 500_000;

export type Currency = 'soft' | 'pog';

export interface Listing {
  wallet: string;
  seller: string;
  price: number;
  /** in-game $POG, or the real token on chain */
  currency: Currency;
  /** a snapshot for the shop window; the live igloo is what transfers */
  level: number;
  levelLabel: string;
  pieces: number;
  style: string;
  x: number;
  y: number;
  listedAt: number;
}

const igloos = async () => (await kv()).hgetall<Igloo>(K.igloos);
const iglooOf = async (wallet: string) => (await kv()).hget<Igloo>(K.igloos, wallet);
const saveIgloo = async (igloo: Igloo) => (await kv()).hset(K.igloos, igloo.wallet, igloo);

/* ------------------------------------------------------------------ *
 * The daily yield
 * ------------------------------------------------------------------ */

/**
 * Settle whatever an igloo has earned since it was last read, and credit
 * it. Assumes the caller holds the wallet lock. `reset` is for a level
 * change: pay what the old level earned, then start the new one from now.
 */
async function settleNow(
  wallet: string,
  profile?: Profile | null,
  reset = false
): Promise<{ paid: number; profile?: Profile }> {
  const igloo = await iglooOf(wallet);
  if (!igloo) return { paid: 0 };

  const now = Date.now();
  const since = igloo.lastYield ?? igloo.builtAt;
  const { paid, next } = settleYieldAt(igloo.furniture ?? [], since, now, reset);

  if (next !== since) {
    igloo.lastYield = next;
    await saveIgloo(igloo);
  }
  if (paid <= 0) return { paid: 0 };

  const p = profile ?? (await getProfile(wallet));
  if (!p) return { paid: 0 };

  p.pog += paid;
  const saved = await putProfile(p);
  await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
  return { paid, profile: saved };
}

/** The request-boundary version: takes the lock itself. */
export const settleYield = (wallet: string) => withWallet(wallet, () => settleNow(wallet));

/* ------------------------------------------------------------------ *
 * Buying and placing
 * ------------------------------------------------------------------ */

/** Buy a furnishing. It lands in the backpack until you place it. */
export const buyFurniture = (wallet: string, id: unknown, qty: unknown) =>
  withWallet(wallet, () => buyFurnitureNow(wallet, id, qty));

async function buyFurnitureNow(
  wallet: string,
  id: unknown,
  qty: unknown
): Promise<{ profile?: Profile; error?: string }> {
  const spec = furnitureById(id);
  if (!spec) return { error: 'No such furnishing.' };

  const count = Math.max(1, Math.min(5, Math.floor(Number(qty) || 1)));
  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  const cost = spec.price * count;
  if (profile.pog < cost) return { error: `That costs ${cost} $POG.` };

  profile.pog -= cost;
  const key = 'f_' + spec.id;
  profile.items[key] = (profile.items[key] || 0) + count;

  const saved = await putProfile(profile);
  await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
  return { profile: saved };
}

/** Nothing inside an igloo may change while it is for sale or reserved. */
async function frozen(wallet: string): Promise<string | null> {
  if (await isListed(wallet)) return 'Take it off the market first.';
  return null;
}

/** Stand a piece from the backpack somewhere in your own igloo. */
export const placeFurniture = (wallet: string, id: unknown, x: unknown, y: unknown) =>
  withWallet(wallet, () => placeFurnitureNow(wallet, id, x, y));

async function placeFurnitureNow(
  wallet: string,
  id: unknown,
  x: unknown,
  y: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; error?: string }> {
  const spec = furnitureById(id);
  if (!spec) return { error: 'No such furnishing.' };

  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'Raise an igloo first.' };
  const locked = await frozen(wallet);
  if (locked) return { error: locked };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  const key = 'f_' + spec.id;
  if (!(profile.items[key] > 0)) return { error: `You have no ${spec.label.toLowerCase()}.` };

  const pieces = igloo.furniture ?? [];
  if (pieces.length >= FURNITURE_LIMIT) return { error: 'There is no more room in here.' };

  const px = Math.round(Number(x));
  const py = Math.round(Number(y));
  const spot = canPlaceFurniture(px, py, spec, pieces);
  if (!spot.ok) return { error: spot.reason };

  // Pay out at the old level and restart the clock, or the stretch that
  // just passed is paid at the new rate.
  const settled = await settleNow(wallet, profile, true);
  const current = settled.profile ?? profile;

  const fresh = (await iglooOf(wallet))!;
  fresh.furniture = [...(fresh.furniture ?? []), { id: spec.id, x: px, y: py }];
  await saveIgloo(fresh);

  current.items[key] -= 1;
  if (current.items[key] <= 0) delete current.items[key];
  return { igloo: fresh, profile: await putProfile(current) };
}

/** Take a piece back out. It returns to the backpack, not to $POG. */
export const removeFurniture = (wallet: string, index: unknown) =>
  withWallet(wallet, () => removeFurnitureNow(wallet, index));

async function removeFurnitureNow(
  wallet: string,
  index: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; error?: string }> {
  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'You have no igloo.' };
  const locked = await frozen(wallet);
  if (locked) return { error: locked };

  const pieces = igloo.furniture ?? [];
  const i = Math.floor(Number(index));
  if (!Number.isInteger(i) || i < 0 || i >= pieces.length) return { error: 'Nothing there.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  const settled = await settleNow(wallet, profile, true);
  const current = settled.profile ?? profile;

  const fresh = (await iglooOf(wallet))!;
  const live = fresh.furniture ?? [];
  if (i >= live.length) return { error: 'Nothing there.' };
  const [taken] = live.splice(i, 1);
  fresh.furniture = live;
  await saveIgloo(fresh);

  const key = 'f_' + taken.id;
  current.items[key] = (current.items[key] || 0) + 1;
  return { igloo: fresh, profile: await putProfile(current) };
}

/* ------------------------------------------------------------------ *
 * The market
 * ------------------------------------------------------------------ */

export const isListed = async (wallet: string) =>
  (await (await kv()).hget<Listing>(K.market, wallet)) != null;

export async function listings(): Promise<Listing[]> {
  const all = (await (await kv()).hgetall<Listing>(K.market)) || {};
  return Object.values(all)
    .filter((l) => l && Number.isFinite(l.price))
    .map((l) => ({ ...l, currency: l.currency === 'pog' ? 'pog' : 'soft' }) as Listing)
    .sort((a, b) => (a.currency === b.currency ? a.price - b.price : a.currency === 'soft' ? -1 : 1));
}

export const listIgloo = (wallet: string, price: unknown, currency: unknown) =>
  withWallet(wallet, () => listIglooNow(wallet, price, currency));

async function listIglooNow(
  wallet: string,
  price: unknown,
  currency: unknown
): Promise<{ listing?: Listing; error?: string }> {
  const kind: Currency = currency === 'pog' ? 'pog' : 'soft';
  const asking = Math.floor(Number(price));

  if (kind === 'pog') {
    if (!chainLive()) return { error: 'Real $POG sales open once the token is live.' };
    if (!Number.isFinite(asking) || asking < SALE_MIN || asking > SALE_MAX) {
      return { error: `Ask between ${SALE_MIN} and ${SALE_MAX.toLocaleString('en-US')} $POG.` };
    }
  } else if (!Number.isFinite(asking) || asking < PRICE_MIN || asking > PRICE_MAX) {
    return { error: `Ask between ${PRICE_MIN} and ${PRICE_MAX.toLocaleString('en-US')} $POG.` };
  }

  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'You have no igloo to sell.' };
  if (await isListed(wallet)) return { error: 'It is already up for sale.' };

  // settle first: the seller keeps what it earned under their ownership
  await settleNow(wallet);

  const level = iglooLevel(igloo.furniture ?? []);
  const listing: Listing = {
    wallet,
    seller: igloo.owner,
    price: asking,
    currency: kind,
    level: level.level,
    levelLabel: level.label,
    pieces: (igloo.furniture ?? []).length,
    style: igloo.style,
    x: igloo.x,
    y: igloo.y,
    listedAt: Date.now(),
  };
  await (await kv()).hset(K.market, wallet, listing);
  return { listing };
}

export const unlistIgloo = (wallet: string) => withWallet(wallet, () => unlistIglooNow(wallet));

async function unlistIglooNow(wallet: string): Promise<{ ok?: boolean; error?: string }> {
  const store = await kv();
  const listing = await store.hget<Listing>(K.market, wallet);
  if (!listing) return { error: 'It is not listed.' };
  // A buyer who has reserved it is paying for it right now.
  if (await reservationOf(wallet, listing.listedAt)) {
    return { error: 'A buyer is paying for it. Try again in a few minutes.' };
  }
  await store.hdel(K.market, wallet);
  return { ok: true };
}

/**
 * Buy somebody's igloo for soft $POG: the plot, its level, and everything
 * standing in it. The seller is paid less the house cut, which is burned.
 *
 * The caller must already have checked that BOTH wallets have qualified
 * for the season — that check needs the chain and the captcha, which
 * belong at the request boundary rather than in the middle of a transfer.
 */
export async function buyIgloo(
  buyer: string,
  sellerWallet: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; paid?: number; burned?: number; error?: string }> {
  if (typeof sellerWallet !== 'string' || !sellerWallet) return { error: 'No such listing.' };
  if (sellerWallet === buyer) return { error: 'It is already yours.' };

  // Both locks, so neither side's balance can be touched by a stray
  // request between the check and the write.
  return withWallets([buyer, sellerWallet], async () => {
    const store = await kv();
    const listing = await store.hget<Listing>(K.market, sellerWallet);
    if (!listing) return { error: 'That one has gone.' };
    if (listing.currency === 'pog') return { error: 'That one is paid for on chain.' };

    const [buyerProfile, igloo] = await Promise.all([getProfile(buyer), iglooOf(sellerWallet)]);
    if (!buyerProfile) return { error: 'Pick a username first.' };
    if (!igloo) {
      await store.hdel(K.market, sellerWallet);
      return { error: 'That one has gone.' };
    }
    if (await iglooOf(buyer)) {
      return { error: 'You already have an igloo. Sell it first.' };
    }
    if (buyerProfile.pog < listing.price) return { error: `That costs ${listing.price} $POG.` };

    // whatever it earned up to this moment belongs to the seller
    await settleNow(sellerWallet);

    const burned = Math.max(1, Math.round(listing.price * MARKET_FEE));
    const takeHome = listing.price - burned;

    buyerProfile.pog -= listing.price;
    const savedBuyer = await putProfile(buyerProfile);

    const seller = await getProfile(sellerWallet);
    if (seller) {
      seller.pog += takeHome;
      const savedSeller = await putProfile(seller);
      await store.zadd(K.leaderboard, savedSeller.pog, sellerWallet);
    }

    // the igloo itself moves, furniture, level and plot together
    const moved: Igloo = {
      ...igloo,
      wallet: buyer,
      owner: savedBuyer.name,
      lastYield: Date.now(),
    };
    await store.hdel(K.igloos, sellerWallet);
    await store.hset(K.igloos, buyer, moved);
    await store.hdel(K.market, sellerWallet);
    await store.zadd(K.leaderboard, savedBuyer.pog, buyer);

    return { igloo: moved, profile: savedBuyer, paid: takeHome, burned };
  });
}

/* ------------------------------------------------------------------ *
 * Reading it back
 * ------------------------------------------------------------------ */

export async function homeState(wallet: string) {
  const [igloo, market, all, reserved] = await Promise.all([
    iglooOf(wallet),
    listings(),
    igloos(),
    isReserved(wallet),
  ]);
  const pieces = igloo?.furniture ?? [];
  const level = iglooLevel(pieces);

  return {
    igloo: igloo ?? null,
    level,
    pieces,
    limit: FURNITURE_LIMIT,
    listed: market.some((l) => l.wallet === wallet),
    /** a buyer is mid-payment on your listing */
    reserved,
    pending: igloo ? yieldOwed(pieces, igloo.lastYield ?? igloo.builtAt) : 0,
    catalogue: Object.values(FURNITURE),
    market,
    fee: MARKET_FEE,
    /** the on-chain market: whether it is open, and its own cut */
    chain: { live: chainLive(), fee: SALE_FEE, min: SALE_MIN, max: SALE_MAX },
    /** every igloo in the world, so visitors see what is inside one */
    world: Object.values(all || {}).filter((i) => i && Number.isFinite(i.x)),
  };
}
