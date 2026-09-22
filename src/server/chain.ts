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

/* ------------------------------------------------------------------ *
 * The market's side of the chain
 *
 * Same discipline as above: one JSON-RPC call each, a short timeout, and
 * a null on any failure that the caller turns into "try again" rather
 * than into a decision.
 * ------------------------------------------------------------------ */

/** `null` when the call itself failed; otherwise the result, which may itself be null. */
async function rpc<T>(method: string, params: unknown[], timeoutMs = RPC_TIMEOUT_MS): Promise<{ result: T } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: T; error?: unknown };
    if (json.error || !('result' in json)) return null;
    return { result: json.result as T };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface MintInfo {
  decimals: number;
  /** which token program owns the mint — the burn has to go to the same one */
  program: string;
}

/**
 * The mint's decimals and owning program. A property of the token, not of
 * any wallet, so it is cached for a long time.
 */
export async function mintInfo(): Promise<MintInfo | null> {
  if (!chainLive()) return null;
  const store = await kv();
  const cached = await store.get<MintInfo>('pog:mint:' + POG_MINT);
  if (cached && Number.isInteger(cached.decimals)) return cached;

  const acct = await rpc<{ value?: { owner?: string; data?: { parsed?: { info?: { decimals?: number } } } } }>(
    'getAccountInfo',
    [POG_MINT, { encoding: 'jsonParsed' }]
  );
  const decimals = acct?.result?.value?.data?.parsed?.info?.decimals;
  const program = acct?.result?.value?.owner;
  if (!Number.isInteger(decimals) || typeof program !== 'string') return null;

  const info = { decimals: decimals as number, program };
  await store.set('pog:mint:' + POG_MINT, info, { ex: 24 * 3600 });
  return info;
}

/** A recent blockhash for building a transaction the buyer will sign. */
export async function latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number } | null> {
  const r = await rpc<{ value?: { blockhash?: string; lastValidBlockHeight?: number } }>('getLatestBlockhash', [
    { commitment: 'finalized' },
  ]);
  const v = r?.result?.value;
  return v?.blockhash && Number.isFinite(v.lastValidBlockHeight)
    ? { blockhash: v.blockhash, lastValidBlockHeight: v.lastValidBlockHeight as number }
    : null;
}

/**
 * One transaction, parsed, at FINALIZED commitment. Returns `undefined`
 * when the chain does not know it yet (or not finally), `null` on an RPC
 * failure, and the parsed transaction otherwise. The three are different
 * answers: "wait", "try again", and "here it is".
 */
export async function finalizedTransaction(signature: string): Promise<unknown | null | undefined> {
  const r = await rpc<unknown>(
    'getTransaction',
    [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
    6000
  );
  if (r === null) return null;
  return r.result == null ? undefined : r.result;
}
