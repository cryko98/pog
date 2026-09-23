/**
 * The goods market: players sell wood, ice and fish to each other
 * for P coins.
 *
 * ------------------------------------------------------------------ *
 * How a listing works
 * ------------------------------------------------------------------ *
 *
 * The goods leave the seller's pack the moment the lot goes up — a lot
 * is real, not a promise — and come back if it is taken down. A buyer
 * pays P coins for any part of a lot; the seller is paid less a cut that
 * is burned, and the goods land in the buyer's pack under the same hold
 * cap as everything else, so the market is not a bigger pack either.
 *
 * Both sides have to have qualified for the season, the same as the
 * igloo market: a bazaar is the natural laundering route for a farm of
 * shallow wallets feeding one deep one. And both sides have to be
 * standing at the market house — a trade is something you walk to.
 *
 * Nothing here writes Frost.
 */

import { kv } from './kv.js';
import { withWallet, withWallets } from './lock.js';
import { GATHER, getNode } from '../../shared/world.js';
import { K, getProfile, holdCap, putProfile, trackMovement, type Profile } from './game.js';

/** Burned out of every sale. */
export const BAZAAR_FEE = 0.05;
export const BAZAAR = {
  /** P coins per unit */
  minEach: 1,
  maxEach: 10_000,
  minQty: 1,
  maxQty: 5_000,
  /** lots per wallet at once */
  maxLots: 6,
  fee: BAZAAR_FEE,
};

export const GOODS = ['wood', 'ice', 'fish'] as const;
export type Good = (typeof GOODS)[number];
const isGood = (g: unknown): g is Good => typeof g === 'string' && (GOODS as readonly string[]).includes(g);

export interface Lot {
  id: string;
  wallet: string;
  seller: string;
  good: Good;
  qty: number;
  each: number;
  listedAt: number;
}

const KEY = {
  lots: 'pog:bazaar',
  rate: (wallet: string) => `pog:bazaar:rate:${wallet}`,
};

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const TRADES_PER_MIN = 20;

/** Standing at the market house. */
async function atMarket(wallet: string, x: unknown, y: unknown): Promise<string | null> {
  const market = getNode('station-market');
  const px = Number(x);
  const py = Number(y);
  if (!market) return 'The market is not there.';
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 'Where are you?';
  if (Math.hypot(px - market.x, py - market.y) > GATHER.range * 2.2) return 'Walk over to the market first.';
  return trackMovement(wallet, px, py);
}

export async function lots(): Promise<Lot[]> {
  const all = (await (await kv()).hgetall<Lot>(KEY.lots)) || {};
  return Object.values(all)
    .filter((l) => l && isGood(l.good) && l.qty > 0)
    .sort((a, b) => (a.good === b.good ? a.each - b.each || a.listedAt - b.listedAt : GOODS.indexOf(a.good) - GOODS.indexOf(b.good)));
}

/* ------------------------------------------------------------------ *
 * Selling
 * ------------------------------------------------------------------ */

export async function listLot(wallet: string, good: unknown, qty: unknown, each: unknown, x: unknown, y: unknown): Promise<{ lot?: Lot; profile?: Profile; error?: string }> {
  if (!isGood(good)) return { error: 'The market takes wood, ice and fish.' };
  const n = Math.floor(Number(qty));
  const price = Math.floor(Number(each));
  if (!Number.isFinite(n) || n < BAZAAR.minQty || n > BAZAAR.maxQty) return { error: `Sell between ${BAZAAR.minQty} and ${BAZAAR.maxQty.toLocaleString('en-US')} at a time.` };
  if (!Number.isFinite(price) || price < BAZAAR.minEach || price > BAZAAR.maxEach) {
    return { error: `Ask between ${BAZAAR.minEach} and ${BAZAAR.maxEach.toLocaleString('en-US')} P coins each.` };
  }
  const where = await atMarket(wallet, x, y);
  if (where) return { error: where };

  return withWallet(wallet, async () => {
    const store = await kv();
    if ((await store.incrWithTtl(KEY.rate(wallet), 60)) > TRADES_PER_MIN) return { error: 'Slow down.' };
    const profile = await getProfile(wallet);
    if (!profile) return { error: 'Pick a username first.' };
    const mine = (await lots()).filter((l) => l.wallet === wallet);
    if (mine.length >= BAZAAR.maxLots) return { error: `You can have ${BAZAAR.maxLots} lots up at once.` };
    if (profile[good] < n) return { error: `You have ${profile[good]} ${good}, not ${n}.` };

    profile[good] -= n;
    const saved = await putProfile(profile);
    const lot: Lot = { id: newId(), wallet, seller: saved.name, good, qty: n, each: price, listedAt: Date.now() };
    await store.hset(KEY.lots, lot.id, lot);
    return { lot, profile: saved };
  });
}

export async function unlistLot(wallet: string, id: unknown, x: unknown, y: unknown): Promise<{ profile?: Profile; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such lot.' };
  const where = await atMarket(wallet, x, y);
  if (where) return { error: where };

  return withWallet(wallet, async () => {
    const store = await kv();
    const lot = await store.hget<Lot>(KEY.lots, id);
    if (!lot || lot.wallet !== wallet) return { error: 'That lot is not yours.' };
    const profile = await getProfile(wallet);
    if (!profile) return { error: 'Pick a username first.' };
    if (profile.wood + profile.ice + profile.fish + lot.qty > holdCap(profile)) {
      return { error: 'Your pack cannot hold it all. Sell some, or take it back in parts later.' };
    }
    await store.hdel(KEY.lots, id);
    profile[lot.good] += lot.qty;
    return { profile: await putProfile(profile) };
  });
}

/* ------------------------------------------------------------------ *
 * Buying
 * ------------------------------------------------------------------ */

export async function buyLot(buyer: string, id: unknown, qty: unknown, x: unknown, y: unknown): Promise<{ profile?: Profile; bought?: number; paid?: number; burned?: number; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such lot.' };
  const want = Math.floor(Number(qty));
  if (!Number.isFinite(want) || want < 1) return { error: 'How many?' };
  const where = await atMarket(buyer, x, y);
  if (where) return { error: where };

  const peek = await (await kv()).hget<Lot>(KEY.lots, id);
  if (!peek) return { error: 'That lot has gone.' };
  if (peek.wallet === buyer) return { error: 'That is your own lot — take it down instead.' };

  return withWallets([buyer, peek.wallet], async () => {
    const store = await kv();
    if ((await store.incrWithTtl(KEY.rate(buyer), 60)) > TRADES_PER_MIN) return { error: 'Slow down.' };
    const lot = await store.hget<Lot>(KEY.lots, id);
    if (!lot) return { error: 'That lot has gone.' };
    const n = Math.min(want, lot.qty);
    const cost = n * lot.each;

    const buyerProfile = await getProfile(buyer);
    if (!buyerProfile) return { error: 'Pick a username first.' };
    if (buyerProfile.pog < cost) return { error: `That costs ${cost.toLocaleString('en-US')} P coins.` };
    if (buyerProfile.wood + buyerProfile.ice + buyerProfile.fish + n > holdCap(buyerProfile)) {
      return { error: 'Your pack cannot hold that many. Buy fewer, or put something away at home.' };
    }

    const burned = Math.max(1, Math.round(cost * BAZAAR_FEE));
    const takeHome = cost - burned;

    buyerProfile.pog -= cost;
    buyerProfile[lot.good] += n;
    const savedBuyer = await putProfile(buyerProfile);
    await store.zadd(K.leaderboard, savedBuyer.pog, buyer);

    const seller = await getProfile(lot.wallet);
    if (seller) {
      seller.pog += takeHome;
      const savedSeller = await putProfile(seller);
      await store.zadd(K.leaderboard, savedSeller.pog, lot.wallet);
    }

    if (n >= lot.qty) await store.hdel(KEY.lots, id);
    else await store.hset(KEY.lots, id, { ...lot, qty: lot.qty - n });

    return { profile: savedBuyer, bought: n, paid: takeHome, burned };
  });
}
