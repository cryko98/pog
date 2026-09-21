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
import { api, clearSession, saveSession, storedToken, storedWallet, type Profile } from '../lib/api';
import { clearGuest, createGuest, loadGuest, saveGuest, type Guest } from '../lib/guest';

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
  /** true once there is someone to play as — wallet profile or guest */
  canPlay: boolean;
  restoring: boolean;
  connect: (info: WalletInfo) => Promise<void>;
  playAsGuest: () => void;
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
  const [guest, setGuest] = useState<Guest | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(true);
  const unsubAccount = useRef<() => void>(() => {});

  useEffect(() => onWalletsChange(setWallets), []);

  // Resume a previous session: the bearer token outlives a page reload.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!storedToken()) {
        // no wallet session, but a guest penguin may be waiting
        if (alive) setGuest(loadGuest());
        setRestoring(false);
        return;
      }
      try {
        const { wallet, profile: p } = await api.me();
        if (!alive) return;
        setAddress(wallet);
        setProfile(p);
        setStatus('ready');
      } catch {
        clearSession();
        if (alive) {
          setAddress('');
          setGuest(loadGuest());
        }
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
    setGuest(null);
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
        setGuest(null); // a real wallet supersedes the guest penguin
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

  const playAsGuest = useCallback(() => {
    setError('');
    setGuest(loadGuest() ?? createGuest());
  }, []);

  /** Wallet profiles go to the server; guest penguins stay in this browser. */
  const saveProfile = useCallback(
    async (name: string, color: string) => {
      if (status === 'ready') {
        const { profile: p } = await api.saveProfile(name, color);
        setProfile(p);
        return;
      }
      const next: Guest = { id: (guest ?? createGuest()).id, name, color };
      saveGuest(next);
      setGuest(next);
    },
    [status, guest]
  );

  // Stable identity on purpose: consumers put this in effect deps, and a new
  // function on every error would re-run their cleanup and wipe the message.
  const clearError = useCallback(() => setError(''), []);

  const identity = useMemo<Identity | null>(() => {
    if (status === 'ready' && profile?.name) {
      return { id: profile.wallet, name: profile.name, color: profile.color, pog: profile.pog ?? 0, guest: false };
    }
    if (guest) return { id: guest.id, name: guest.name, color: guest.color, pog: 0, guest: true };
    return null;
  }, [status, profile, guest]);

  const value = useMemo<SessionValue>(
    () => ({
      wallets,
      connected,
      address,
      profile,
      guest,
      identity,
      status,
      error,
      restoring,
      canPlay: !!identity,
      connect,
      playAsGuest,
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
      playAsGuest,
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
