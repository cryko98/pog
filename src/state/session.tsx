import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  connectWallet,
  disconnectWallet,
  listWallets,
  onAccountChange,
  onWalletsChange,
  signMessage,
  type ConnectedWallet,
  type WalletInfo,
} from '../lib/wallet';
import { api, clearSession, saveSession, storedToken, storedWallet, type Profile, type PlayGate } from '../lib/api';
import { clearGuest, type Guest } from '../lib/guest';

type Status = 'idle' | 'connecting' | 'signing' | 'ready';

/** Who the player is on the ice, wallet-backed or not. */
export interface Identity {
  /** presence-channel id: the wallet address, or a local guest id */
  id: string;
  name: string;
  color: string;
  pog: number;
  guest: boolean;
}

interface SessionValue {
  wallets: WalletInfo[];
  connected: ConnectedWallet | null;
  address: string;
  profile: Profile | null;
  guest: Guest | null;
  identity: Identity | null;
  status: Status;
  error: string;
  /** where the wallet stands at the door: holds enough to play, or not */
  gate: PlayGate | null;
  /** true once there is someone to play as: a named wallet that may pass the door */
  canPlay: boolean;
  restoring: boolean;
  connect: (info: WalletInfo) => Promise<void>;
  logout: () => Promise<void>;
  saveProfile: (name: string, color: string) => Promise<void>;
  clearError: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletInfo[]>(() => listWallets());
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [address, setAddress] = useState<string>(() => storedWallet());
  const [profile, setProfile] = useState<Profile | null>(null);
  // guests are gone: the ice is for holders. Anyone still carrying a guest
  // penguin from before is shown the door on their next visit.
  const [guest] = useState<Guest | null>(null);
  const [gate, setGate] = useState<PlayGate | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(true);
  const unsubAccount = useRef<() => void>(() => {});

  useEffect(() => onWalletsChange(setWallets), []);

  // Resume a previous session: the bearer token outlives a page reload.
  useEffect(() => {
    let alive = true;
    (async () => {
      clearGuest();
      if (!storedToken()) {
        setRestoring(false);
        return;
      }
      try {
        const { wallet, profile: p, gate: g } = await api.me();
        if (!alive) return;
        setAddress(wallet);
        setProfile(p);
        setGate(g ?? null);
        setStatus('ready');
      } catch {
        clearSession();
        if (alive) setAddress('');
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    unsubAccount.current();
    await api.logout();
    await disconnectWallet(connected);
    clearSession();
    clearGuest();
    setConnected(null);
    setAddress('');
    setProfile(null);
    setGate(null);
    setStatus('idle');
  }, [connected]);

  const connect = useCallback(
    async (info: WalletInfo) => {
      setError('');
      setStatus('connecting');
      try {
        const link = await connectWallet(info);
        setConnected(link);
        setAddress(link.address);

        setStatus('signing');
        const { message } = await api.nonce(link.address);
        const signature = await signMessage(link, message);
        const { token, profile: p } = await api.verify(link.address, signature);

        saveSession(token, link.address);
        setProfile(p);
        // where this wallet stands at the door
        try {
          const me = await api.me();
          setGate(me.gate ?? null);
        } catch {
          setGate(null);
        }
        setStatus('ready');

        unsubAccount.current();
        unsubAccount.current = onAccountChange(link, (next) => {
          if (next !== link.address) void logout();
        });
      } catch (err) {
        console.error('[pog] wallet connect failed', err);
        const message = err instanceof Error ? err.message : String(err);
        const cancelled = /reject|declin|denied|cancel|user/i.test(message);
        setError(cancelled ? 'You cancelled the request in your wallet.' : message);
        setStatus('idle');
        setConnected(null);
      }
    },
    [logout]
  );

  const saveProfile = useCallback(async (name: string, color: string) => {
    const { profile: p } = await api.saveProfile(name, color);
    setProfile(p);
  }, []);

  // Stable identity on purpose: consumers put this in effect deps, and a new
  // function on every error would re-run their cleanup and wipe the message.
  const clearError = useCallback(() => setError(''), []);

  const identity = useMemo<Identity | null>(() => {
    if (status === 'ready' && profile?.name) {
      return { id: profile.wallet, name: profile.name, color: profile.color, pog: profile.pog ?? 0, guest: false };
    }
    return null;
  }, [status, profile]);

  const value = useMemo<SessionValue>(
    () => ({
      wallets,
      connected,
      address,
      profile,
      guest,
      identity,
      gate,
      status,
      error,
      restoring,
      canPlay: !!identity && gate?.ok !== false,
      connect,
      logout,
      saveProfile,
      clearError,
    }),
    [
      wallets,
      connected,
      address,
      profile,
      guest,
      identity,
      status,
      error,
      restoring,
      connect,
      logout,
      saveProfile,
      clearError,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
