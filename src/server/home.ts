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
 * the qualifying gate exists to stop. Everything here is soft $POG.
 *
 * A market is also the natural laundering route for a sybil farm: many
 * shallow wallets selling to one deep one. So both sides of a sale must
 * have passed the Frost gate, and the house takes a cut that is burned
 * rather than paid to anyone, which puts a real price on a wash trade.
 */

import { kv } from './kv.js';
import {
  FURNITURE,
  FURNITURE_LIMIT,
  canPlaceFurniture,
  furnitureById,
  iglooLevel,
  yieldOwed,
} from '../../shared/world.js';
import { K, getProfile, putProfile, type Igloo, type Profile } from './game.js';

/** Listings live in one hash, keyed by the seller's wallet. */
const MARKET = 'pog:market';

/** Taken out of every sale and burned — the cost of a wash trade. */
export const MARKET_FEE = 0.08;
export const PRICE_MIN = 5;
export const PRICE_MAX = 500_000;

export interface Listing {
  wallet: string;
  seller: string;
  price: number;
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
 * it. Called whenever the owner loads their game state, so from the
 * player's side it simply arrives — but it is computed from elapsed time
 * and capped, so leaving the game open does not earn any faster than
 * leaving it shut.
 */
export async function settleYield(
  wallet: string,
  profile?: Profile | null
): Promise<{ paid: number; profile?: Profile }> {
  const igloo = await iglooOf(wallet);
  if (!igloo) return { paid: 0 };

  const now = Date.now();
  const owed = yieldOwed(igloo.furniture ?? [], igloo.lastYield ?? igloo.builtAt, now);
  if (owed <= 0) {
    // still move the clock on, or a level-1 igloo banks time it cannot use
    if (!igloo.lastYield) {
      igloo.lastYield = now;
      await saveIgloo(igloo);
    }
    return { paid: 0 };
  }

  const p = profile ?? (await getProfile(wallet));
  if (!p) return { paid: 0 };

  igloo.lastYield = now;
  await saveIgloo(igloo);

  p.pog += owed;
  const saved = await putProfile(p);
  await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
  return { paid: owed, profile: saved };
}

/* ------------------------------------------------------------------ *
 * Buying and placing
 * ------------------------------------------------------------------ */

/** Buy a furnishing. It lands in the backpack until you place it. */
export async function buyFurniture(
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

/** Stand a piece from the backpack somewhere in your own igloo. */
export async function placeFurniture(
  wallet: string,
  id: unknown,
  x: unknown,
  y: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; error?: string }> {
  const spec = furnitureById(id);
  if (!spec) return { error: 'No such furnishing.' };

  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'Raise an igloo first.' };
  if (await isListed(wallet)) return { error: 'Take it off the market first.' };

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

  // settle before the level changes, or the last stretch pays at the new rate
  await settleYield(wallet, profile);

  igloo.furniture = [...pieces, { id: spec.id, x: px, y: py }];
  await saveIgloo(igloo);

  const fresh = (await getProfile(wallet))!;
  fresh.items[key] -= 1;
  return { igloo, profile: await putProfile(fresh) };
}

/** Take a piece back out. It returns to the backpack, not to $POG. */
export async function removeFurniture(
  wallet: string,
  index: unknown
): Promise<{ igloo?: Igloo; profile?: Profile; error?: string }> {
  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'You have no igloo.' };
  if (await isListed(wallet)) return { error: 'Take it off the market first.' };

  const pieces = igloo.furniture ?? [];
  const i = Math.floor(Number(index));
  if (!Number.isInteger(i) || i < 0 || i >= pieces.length) return { error: 'Nothing there.' };

  const profile = await getProfile(wallet);
  if (!profile) return { error: 'Pick a username first.' };

  await settleYield(wallet, profile);

  const [taken] = pieces.splice(i, 1);
  igloo.furniture = pieces;
  await saveIgloo(igloo);

  const fresh = (await getProfile(wallet))!;
  const key = 'f_' + taken.id;
  fresh.items[key] = (fresh.items[key] || 0) + 1;
  return { igloo, profile: await putProfile(fresh) };
}

/* ------------------------------------------------------------------ *
 * The market
 * ------------------------------------------------------------------ */

export const isListed = async (wallet: string) =>
  (await (await kv()).hget<Listing>(MARKET, wallet)) != null;

export async function listings(): Promise<Listing[]> {
  const all = (await (await kv()).hgetall<Listing>(MARKET)) || {};
  return Object.values(all)
    .filter((l) => l && Number.isFinite(l.price))
    .sort((a, b) => a.price - b.price);
}

export async function listIgloo(
  wallet: string,
  price: unknown
): Promise<{ listing?: Listing; error?: string }> {
  const asking = Math.floor(Number(price));
  if (!Number.isFinite(asking) || asking < PRICE_MIN || asking > PRICE_MAX) {
    return { error: `Ask between ${PRICE_MIN} and ${PRICE_MAX.toLocaleString('en-US')} $POG.` };
  }

  const igloo = await iglooOf(wallet);
  if (!igloo) return { error: 'You have no igloo to sell.' };
  if (await isListed(wallet)) return { error: 'It is already up for sale.' };

  // settle first: the seller keeps what it earned under their ownership
  await settleYield(wallet);

  const level = iglooLevel(igloo.furniture ?? []);
  const listing: Listing = {
    wallet,
    seller: igloo.owner,
    price: asking,
    level: level.level,
    levelLabel: level.label,
    pieces: (igloo.furniture ?? []).length,
    style: igloo.style,
    x: igloo.x,
    y: igloo.y,
    listedAt: Date.now(),
  };
  await (await kv()).hset(MARKET, wallet, listing);
  return { listing };
}

export async function unlistIgloo(wallet: string): Promise<{ ok?: boolean; error?: string }> {
  if (!(await isListed(wallet))) return { error: 'It is not listed.' };
  await (await kv()).hdel(MARKET, wallet);
  return { ok: true };
}

/**
 * Buy somebody's igloo: the plot, its level, and everything standing in
 * it. The seller is paid less the house cut, which is burned.
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

  const store = await kv();
  const listing = await store.hget<Listing>(MARKET, sellerWallet);
  if (!listing) return { error: 'That one has gone.' };

  const [buyerProfile, sellerProfile, igloo] = await Promise.all([
    getProfile(buyer),
    getProfile(sellerWallet),
    iglooOf(sellerWallet),
  ]);
  if (!buyerProfile) return { error: 'Pick a username first.' };
  if (!igloo) {
    await store.hdel(MARKET, sellerWallet);
    return { error: 'That one has gone.' };
  }
  if (await iglooOf(buyer)) {
    return { error: 'You already have an igloo. Sell or abandon it first.' };
  }
  if (buyerProfile.pog < listing.price) return { error: `That costs ${listing.price} $POG.` };

  // Claim the listing first, atomically. Two buyers racing: one gets it,
  // the other is told it has gone, and nobody pays for nothing.
  if (!(await store.setnx(`pog:sold:${sellerWallet}:${listing.listedAt}`, buyer, 3600))) {
    return { error: 'Somebody just bought it.' };
  }

  // whatever it earned up to this moment belongs to the seller
  await settleYield(sellerWallet, sellerProfile);

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
  await store.hdel(MARKET, sellerWallet);
  await store.zadd(K.leaderboard, savedBuyer.pog, buyer);

  return { igloo: moved, profile: savedBuyer, paid: takeHome, burned };
}

/* ------------------------------------------------------------------ *
 * Reading it back
 * ------------------------------------------------------------------ */

export async function homeState(wallet: string) {
  const [igloo, market, all] = await Promise.all([iglooOf(wallet), listings(), igloos()]);
  const pieces = igloo?.furniture ?? [];
  const level = iglooLevel(pieces);

  return {
    igloo: igloo ?? null,
    level,
    pieces,
    limit: FURNITURE_LIMIT,
    listed: market.some((l) => l.wallet === wallet),
    pending: igloo ? yieldOwed(pieces, igloo.lastYield ?? igloo.builtAt) : 0,
    catalogue: Object.values(FURNITURE),
    market,
    fee: MARKET_FEE,
    /** every igloo in the world, so visitors see what is inside one */
    world: Object.values(all || {}).filter((i) => i && Number.isFinite(i.x)),
  };
}
