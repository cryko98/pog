/**
 * How much $POG a wallet holds on chain.
 *
 * This is the one anti-sybil check that costs an attacker money rather
 * than time, so it is worth doing properly — but it must never be able to
 * break the game. Everything here degrades to "no bonus" and nothing here
 * can block play, gathering, crafting or building. It only ever decides
 * whether Frost accrues and at what multiplier.
 *
 * Deliberately no @solana/web3.js: one JSON-RPC call over fetch does the
 * job and keeps the serverless bundle small.
 */

import { kv } from './kv.js';

/** Unset until the token launches, which is exactly how we detect that. */
export const POG_MINT = (process.env.POG_MINT || '').trim();
const RPC = (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim();

/** Is there a token to check balances against yet? */
export const chainLive = () => POG_MINT.length >= 32;

const CACHE_OK_S = 300;
const CACHE_ERR_S = 30;
const RPC_TIMEOUT_MS = 4000;

const key = (wallet: string) => `pog:hold:${wallet}`;

interface Cached {
  /** whole tokens held, or null when the last lookup failed */
  held: number | null;
  at: number;
}

interface ParsedAccount {
  account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } };
}

async function rpcBalance(wallet: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [wallet, { mint: POG_MINT }, { encoding: 'jsonParsed' }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { value?: ParsedAccount[] }; error?: unknown };
    if (json.error || !json.result) return null;

    // A wallet can hold the same mint in several token accounts.
    let total = 0;
    for (const entry of json.result.value ?? []) {
      const amount = entry?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amount === 'number' && Number.isFinite(amount)) total += amount;
    }
    return Math.floor(total);
  } catch {
    return null; // timeout, network, malformed body — all the same to us
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whole $POG held by this wallet, cached.
 *
 * Returns 0 rather than throwing when the token does not exist yet or the
 * RPC is unreachable. That is a deliberate fail-CLOSED: an unknown balance
 * earns no holder bonus and does not satisfy the minimum-hold gate. Failing
 * open here would hand every sybil the thing the gate exists to prevent.
 *
 * A previous good reading is reused while it is still cached, so a brief
 * RPC outage does not drop honest holders to zero mid-session.
 */
export async function heldBalance(wallet: string): Promise<number> {
  if (!chainLive()) return 0;

  const store = await kv();
  const cached = await store.get<Cached>(key(wallet));
  if (cached && typeof cached.held === 'number') return cached.held;

  const held = await rpcBalance(wallet);
  await store.set(
    key(wallet),
    { held, at: Date.now() } satisfies Cached,
    { ex: held === null ? CACHE_ERR_S : CACHE_OK_S }
  );
  return held ?? 0;
}

/** Everything the gate and the UI need to know about the chain side. */
export async function holdingOf(wallet: string): Promise<{ live: boolean; balance: number }> {
  return { live: chainLive(), balance: await heldBalance(wallet) };
}
