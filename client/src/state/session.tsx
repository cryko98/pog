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

type Status = 'idle' | 'connecting' | 'signing' | 'ready';

interface SessionValue {
  wallets: WalletInfo[];
  connected: ConnectedWallet | null;
  address: string;
  profile: Profile | null;
  status: Status;
  error: string;
  /** true once the wallet is authenticated AND has a username */
  canPlay: boolean;
  restoring: boolean;
  connect: (info: WalletInfo) => Promise<void>;
  logout: () => Promise<void>;
  saveProfile: (name: string, color: string) => Promise<void>;
  setProfile: (p: Profile) => void;
  clearError: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<WalletInfo[]>(() => listWallets());
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [address, setAddress] = useState<string>(() => storedWallet());
  const [profile, setProfile] = useState<Profile | null>(null);
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
    setConnected(null);
    setAddress('');
    setProfile(null);
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
        const { token, profile: p } = await api.auth(link.address, signature);

        saveSession(token, link.address);
        setProfile(p);
        setStatus('ready');

        unsubAccount.current();
        unsubAccount.current = onAccountChange(link, (next) => {
          if (next !== link.address) void logout();
        });
      } catch (err) {
        // keep the raw error in the console — the UI message is deliberately short
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

  const value = useMemo<SessionValue>(
    () => ({
      wallets,
      connected,
      address,
      profile,
      status,
      error,
      restoring,
      canPlay: status === 'ready' && !!profile?.name,
      connect,
      logout,
      saveProfile,
      setProfile,
      clearError,
    }),
    [wallets, connected, address, profile, status, error, restoring, connect, logout, saveProfile, clearError]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
