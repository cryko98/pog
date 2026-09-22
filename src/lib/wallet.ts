// Thin Wallet Standard layer. Every modern Solana wallet (Phantom, Solflare,
// Backpack, Glow, Coinbase…) registers itself this way, so we get them all
// without pulling in the full wallet-adapter React stack.

import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';

/* eslint-disable @typescript-eslint/no-explicit-any */
type StandardWallet = any;
type StandardAccount = any;

export interface WalletInfo {
  name: string;
  icon: string;
  wallet: StandardWallet;
  installed: true;
}

export interface ConnectedWallet {
  name: string;
  icon: string;
  address: string;
  wallet: StandardWallet;
  account: StandardAccount;
}

const CONNECT = 'standard:connect';
const DISCONNECT = 'standard:disconnect';
const EVENTS = 'standard:events';
const SIGN_MESSAGE = 'solana:signMessage';
const SIGN_AND_SEND = 'solana:signAndSendTransaction';
const SOLANA_CHAIN = 'solana:';
const MAINNET = 'solana:mainnet';

/** Wallets we can actually drive: Solana chain + connect + signMessage. */
function usable(wallet: StandardWallet): boolean {
  const chains: string[] = wallet?.chains ?? [];
  return (
    chains.some((c) => c.startsWith(SOLANA_CHAIN)) &&
    !!wallet?.features?.[CONNECT] &&
    !!wallet?.features?.[SIGN_MESSAGE]
  );
}

export function listWallets(): WalletInfo[] {
  try {
    return getWallets()
      .get()
      .filter(usable)
      .map((wallet: StandardWallet) => ({
        name: wallet.name,
        icon: wallet.icon,
        wallet,
        installed: true as const,
      }));
  } catch {
    return [];
  }
}

/** Wallet extensions inject asynchronously, so re-read the registry on change. */
export function onWalletsChange(cb: (wallets: WalletInfo[]) => void): () => void {
  let unregister: Array<() => void> = [];
  try {
    const api = getWallets();
    unregister = [api.on('register', () => cb(listWallets())), api.on('unregister', () => cb(listWallets()))];
  } catch {
    /* no wallet registry in this browser */
  }
  // some extensions land a beat after first paint
  const timers = [250, 800, 2000].map((ms) => window.setTimeout(() => cb(listWallets()), ms));
  return () => {
    unregister.forEach((fn) => fn());
    timers.forEach(clearTimeout);
  };
}

export async function connectWallet(info: WalletInfo): Promise<ConnectedWallet> {
  const { wallet } = info;
  const result = await wallet.features[CONNECT].connect();
  const account: StandardAccount = result?.accounts?.[0] ?? wallet.accounts?.[0];
  if (!account) throw new Error('The wallet returned no account.');
  return { name: wallet.name, icon: wallet.icon, address: account.address, wallet, account };
}

/** Returns the signature as a base58 string, the shape the server verifies. */
export async function signMessage(connected: ConnectedWallet, message: string): Promise<string> {
  const feature = connected.wallet.features[SIGN_MESSAGE];
  if (!feature) throw new Error('This wallet cannot sign messages.');
  const encoded = new TextEncoder().encode(message);
  const [output] = await feature.signMessage({ account: connected.account, message: encoded });
  if (!output?.signature) throw new Error('No signature was returned.');
  return bs58.encode(output.signature);
}

/** Can this wallet send a transaction, not just sign a message? */
export const canSendTransactions = (connected: ConnectedWallet | null): boolean =>
  !!connected?.wallet?.features?.[SIGN_AND_SEND];

/**
 * Sign and send a transaction the server built, and return the signature
 * as base58 — what the server needs to find it on chain.
 *
 * The bytes come from the API already serialised; the wallet decodes and
 * shows them before asking for approval. Nothing is assembled here, so
 * there is nothing here that could quietly change what gets signed.
 */
export async function signAndSendTransaction(connected: ConnectedWallet, base64: string): Promise<string> {
  const feature = connected.wallet.features[SIGN_AND_SEND];
  if (!feature) throw new Error('This wallet cannot send transactions.');
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const [output] = await feature.signAndSendTransaction({
    account: connected.account,
    chain: MAINNET,
    transaction: bytes,
  });
  if (!output?.signature) throw new Error('No signature was returned.');
  return bs58.encode(output.signature);
}

export async function disconnectWallet(connected: ConnectedWallet | null): Promise<void> {
  try {
    await connected?.wallet?.features?.[DISCONNECT]?.disconnect();
  } catch {
    /* wallets may refuse programmatic disconnect — ignore */
  }
}

/** Fires when the user switches accounts or disconnects in the extension. */
export function onAccountChange(connected: ConnectedWallet, cb: (address: string | null) => void): () => void {
  const events = connected.wallet?.features?.[EVENTS];
  if (!events?.on) return () => {};
  try {
    return events.on('change', (props: any) => {
      if (!props?.accounts) return;
      cb(props.accounts[0]?.address ?? null);
    });
  } catch {
    return () => {};
  }
}

export const shortAddress = (address: string, size = 4): string =>
  address.length <= size * 2 + 1 ? address : `${address.slice(0, size)}…${address.slice(-size)}`;

export const WALLET_LINKS = [
  { name: 'Phantom', url: 'https://phantom.app/download' },
  { name: 'Solflare', url: 'https://solflare.com/download' },
  { name: 'Backpack', url: 'https://backpack.app/downloads' },
];
