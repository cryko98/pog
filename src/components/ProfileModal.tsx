import { useEffect, useRef, useState } from 'react';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { SCARF_COLORS } from '../lib/colors';
import { PenguinMark } from './PenguinMark';

export { SCARF_COLORS };

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  /** first-time setup cannot be dismissed without a name */
  required?: boolean;
}

export function ProfileModal({ onClose, onSaved, required }: Props) {
  const { identity, address, saveProfile } = useSession();
  const isGuest = !!identity?.guest;
  const [name, setName] = useState(identity?.name ?? '');
  const [color, setColor] = useState(identity?.color ?? SCARF_COLORS[0]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await saveProfile(name.trim(), color);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={() => !required && onClose()}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{identity?.name ? 'Customise your penguin' : 'Name your penguin'}</h3>
        <p className="sub">
          {isGuest ? (
            <>
              Guest penguins live in this browser only. Connect a wallet to reserve the name and
              start earning $POG.
            </>
          ) : (
            <>
              Saved to your wallet (<code>{shortAddress(address, 4)}</code>) and shown above your
              head to everyone on the ice.
            </>
          )}
        </p>

        <div className="preview">
          <PenguinMark scarf={color} size={120} />
        </div>

        <div className="field">
          <label htmlFor="pog-name">Username</label>
          <input
            id="pog-name"
            ref={inputRef}
            value={name}
            maxLength={16}
            placeholder="e.g. IceKing"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Scarf colour</label>
          <div className="swatches">
            {SCARF_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${c === color ? ' active' : ''}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          {!required && (
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || name.trim().length < 2}>
            {saving ? 'Saving…' : 'Save & play'}
          </button>
        </div>
      </form>
    </div>
  );
}
