import { useEffect } from 'react';
import { useSession } from '../state/session';
import { WALLET_LINKS } from '../lib/wallet';

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, connect, status, error, clearError } = useSession();
  const busy = status === 'connecting' || status === 'signing';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // clear a stale error only when the modal actually goes away
  useEffect(() => () => clearError(), [clearError]);

  return (
    <div className="overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Connect your wallet</h3>
        <p className="sub">
          One free signature proves the wallet is yours. No transaction, no token approval, nothing
          leaves your account.
        </p>

        {error && <div className="form-error">{error}</div>}

        {wallets.length > 0 ? (
          <div className="wallet-list">
            {wallets.map((w) => (
              <button key={w.name} className="wallet-option" disabled={busy} onClick={() => connect(w)}>
                {w.icon && <img src={w.icon} alt="" />}
                {w.name}
                <small>{busy ? (status === 'signing' ? 'sign in wallet…' : 'connecting…') : 'detected'}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-wallets">
            <strong>No Solana wallet found in this browser.</strong>
            <span>Install one, then reload the page:</span>
            <div>
              {WALLET_LINKS.map((l, i) => (
                <span key={l.name}>
                  {i > 0 && ' · '}
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {l.name}
                  </a>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
