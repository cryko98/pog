import { useState } from 'react';
import type { QuestBoard } from '../lib/api';
import { Icon, type IconName } from './Icon';

interface Props {
  board: QuestBoard | null;
  guest: boolean;
  onClaim: (id: string) => Promise<string | null>;
  onClose: () => void;
}

/**
 * Three quests, reset at midnight UTC. They are the reason to open the game
 * tomorrow: the streak only survives if you clear all three today, and the
 * bonus grows with it.
 */
export function QuestPanel({ board, guest, onClaim, onClose }: Props) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const claim = async (id: string) => {
    setBusy(id);
    setNote('');
    const error = await onClaim(id);
    if (error) setNote(error);
    setBusy('');
  };

  return (
    <div className="panel side-panel quests">
      <div className="bp-head">
        <h4>
          <Icon name="quest" size={16} /> Today
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      {guest ? (
        <p className="bp-note">Quests pay out in P coins, so they need a wallet. Guests can still explore.</p>
      ) : !board ? (
        <p className="bp-note">Reading the board…</p>
      ) : (
        <>
          <div className="q-streak">
            <Icon name="fire" size={18} />
            <div>
              <b>{board.streak} day streak</b>
              <small>
                {board.streak === 0
                  ? `Clear all three to start one — worth +${board.streakBonus} P coins.`
                  : `Clear all three again for +${board.streakBonus} P coins on top.`}
              </small>
            </div>
          </div>

          {board.quests.map((q) => {
            const done = q.progress >= q.target;
            const pct = Math.round((Math.min(q.progress, q.target) / q.target) * 100);
            return (
              <div className={`q-row${q.claimed ? ' claimed' : ''}`} key={q.id}>
                <Icon name={q.icon as IconName} size={20} />
                <div className="q-body">
                  <span className="q-label">{q.label}</span>
                  <div className="q-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <small>
                    {Math.min(q.progress, q.target)} / {q.target} · {q.reward} P coins
                  </small>
                </div>
                {q.claimed ? (
                  <span className="q-done" title="Claimed">
                    <Icon name="check" size={16} />
                  </span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!done || busy === q.id}
                    onClick={() => claim(q.id)}
                  >
                    {done ? 'Claim' : `${pct}%`}
                  </button>
                )}
              </div>
            );
          })}

          <p className="bp-note">New quests every day at midnight UTC.</p>
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
