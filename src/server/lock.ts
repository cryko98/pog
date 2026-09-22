/**
 * One writer per wallet at a time.
 *
 * Every mutation in this API is read-modify-write on a profile document:
 * read it, check what it holds, change it, write it back. Two requests for
 * the same wallet arriving together both read the old document, and the
 * second write silently undoes the first. That is not a theoretical race —
 * with Redis a hundred milliseconds away it is a wide window, and a client
 * can open it on purpose by firing two requests at once:
 *
 *   - place a furnishing while a stale write puts it back in the pack
 *   - remove the same piece twice and get two back
 *   - buy an igloo while another request restores the $POG it cost
 *
 * Serialising each wallet's writes closes the whole class rather than the
 * three examples. Multi-wallet operations (a sale) take both locks in a
 * fixed order so two sales between the same pair cannot deadlock.
 */

import { kv } from './kv.js';

/** Longer than any request should take; a stuck holder frees up on its own. */
const LOCK_TTL_MS = 8_000;
/** How long a request will queue behind another before giving up. */
const WAIT_MS = 4_000;
const RETRY_MS = 35;

const key = (wallet: string) => `pog:lock:${wallet}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BusyError extends Error {
  constructor() {
    super('Your penguin is busy — try again in a moment.');
    this.name = 'BusyError';
  }
}

async function acquire(wallet: string): Promise<() => Promise<void>> {
  const store = await kv();
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const release = await store.lock(key(wallet), LOCK_TTL_MS);
    if (release) return release;
    if (Date.now() >= deadline) throw new BusyError();
    await sleep(RETRY_MS + Math.random() * RETRY_MS);
  }
}

/** Run `fn` while holding this wallet's lock. Not re-entrant. */
export async function withWallet<T>(wallet: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquire(wallet);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Hold several wallets' locks at once, always in the same order. */
export async function withWallets<T>(wallets: string[], fn: () => Promise<T>): Promise<T> {
  const order = [...new Set(wallets)].sort();
  const held: Array<() => Promise<void>> = [];
  try {
    for (const w of order) held.push(await acquire(w));
    return await fn();
  } finally {
    for (const release of held.reverse()) await release();
  }
}
