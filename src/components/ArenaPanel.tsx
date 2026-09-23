import { useCallback, useEffect, useState } from 'react';
import { DUEL, STAKE_KEYS } from '../../shared/duel.js';
import { FIGHT } from '../../shared/fight.js';
import type { Inventory } from '../game/engine';
import { api, type DuelStake, type DuelView, type OpenChallenge } from '../lib/api';
import { shortAddress } from '../lib/wallet';
import { Icon } from './Icon';

interface Props {
  guest: boolean;
  inventory: Inventory;
  /** where the player stands, for the arena's position check */
  position: () => { x: number; y: number };
  /** a match is on: hand over to the duel screen */
  onEnter: (id: string) => void;
  onClose: () => void;
}

const big = (n: number) => n.toLocaleString('en-US');

export function describeStake(s: DuelStake): string {
  if (s.kind === 'pog') return `${big(s.amount)} real $POG`;
  return Object.entries(s.items)
    .map(([k, n]) => `${big(n)} ${k === 'pog' ? 'P coins' : k}`)
    .join(' + ');
}

/**
 * The arena's front desk: put up a challenge with a stake, or take one.
 *
 * A stake leaves your pack the moment you put it up — that is what makes
 * the challenge real. It comes back if nobody takes it. The match itself
 * lives on the duel screen.
 */
export function ArenaPanel({ guest, inventory, position, onEnter, onClose }: Props) {
  const [open, setOpen] = useState<OpenChallenge[]>([]);
  const [mine, setMine] = useState<DuelView | null>(null);
  const [realStakes, setRealStakes] = useState(false);
  const [kind, setKind] = useState<'soft' | 'pog'>('soft');
  const [stake, setStake] = useState<Record<string, string>>({ wood: '', ice: '', fish: '', pog: '' });
  const [tokens, setTokens] = useState('100');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(() => {
    api.openChallenges().then((r) => {
      setOpen(r.challenges);
      setRealStakes(r.realStakes);
    }).catch(() => {});
    if (!guest) api.duel().then((r) => setMine(r.match)).catch(() => {});
  }, [guest]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setNote('');
    try {
      await fn();
      setNote(ok);
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not work.');
    }
    setBusy('');
  };

  const stakeObj = () => {
    const out: Record<string, number> = {};
    for (const k of STAKE_KEYS) {
      const n = Math.floor(Number(stake[k]) || 0);
      if (n > 0) out[k] = n;
    }
    return out;
  };

  const canAfford = (s: DuelStake) =>
    s.kind === 'pog' || Object.entries(s.items).every(([k, n]) => (inventory[k as 'wood' | 'ice' | 'fish' | 'pog'] as number) >= n);

  const active = mine && (mine.state === 'live' || mine.state === 'funding');

  return (
    <div className="panel side-panel arena">
      <div className="bp-head">
        <h4>
          <Icon name="snowflake" size={16} /> Snowball arena
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      <p className="bp-note">
        Two penguins face off across the rink. Throw straight balls and lobs, jump the straight
        ones, step out from under the lobs. First to {FIGHT.hitsToWin} hits, or the most when{' '}
        {FIGHT.durationMs / 1000} seconds run out, takes the pot.
      </p>

      {guest ? (
        <p className="bp-note">A stake belongs to a wallet. Connect one to fight.</p>
      ) : (
        <>
          {active && (
            <div className="ar-mine">
              <b>{mine!.state === 'funding' ? 'Stakes being paid' : 'Your match is on'}</b>
              <small>
                vs {mine!.them?.name ?? '—'} · {describeStake(mine!.stake)}
              </small>
              <button className="btn btn-primary btn-sm bp-wide" onClick={() => onEnter(mine!.id)}>
                Enter the arena
              </button>
            </div>
          )}

          {mine?.state === 'open' && (
            <div className="ar-mine">
              <b>Your challenge is up</b>
              <small>{describeStake(mine.stake)} — waiting for a taker. Your stake is held meanwhile.</small>
              <button
                className="btn btn-ghost btn-sm bp-wide"
                disabled={busy === 'cancel'}
                onClick={() => run('cancel', () => api.cancelChallenge(), 'Taken down. Stake returned.')}
              >
                Take it down
              </button>
            </div>
          )}

          {!mine && (
            <>
              <h5>Put up a challenge</h5>
              {realStakes && (
                <div className="hm-cur" role="radiogroup" aria-label="Stake in">
                  <button className={`hm-cur-btn${kind === 'soft' ? ' active' : ''}`} onClick={() => setKind('soft')}>
                    <Icon name="backpack" size={12} /> Resources
                  </button>
                  <button className={`hm-cur-btn${kind === 'pog' ? ' active' : ''}`} onClick={() => setKind('pog')}>
                    ◎ Real $POG
                  </button>
                </div>
              )}
              {kind === 'soft' ? (
                <div className="ar-stake">
                  {STAKE_KEYS.map((k) => (
                    <label key={k}>
                      <span>
                        <Icon name={k === 'pog' ? 'coin' : (k as 'wood' | 'ice' | 'fish')} size={13} /> {k === 'pog' ? 'P coins' : k}
                      </span>
                      <input
                        inputMode="numeric"
                        placeholder="0"
                        value={stake[k]}
                        onChange={(e) => setStake({ ...stake, [k]: e.target.value.replace(/[^0-9]/g, '') })}
                      />
                      <small>have {big(inventory[k as 'wood' | 'ice' | 'fish' | 'pog'] as number)}</small>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="hm-ask">
                  <input
                    inputMode="numeric"
                    value={tokens}
                    onChange={(e) => setTokens(e.target.value.replace(/[^0-9]/g, ''))}
                    aria-label="Stake in real $POG"
                  />
                  <span className="ar-unit">P coins</span>
                </div>
              )}
              <small className="bp-note">
                {kind === 'soft'
                  ? `Winner takes both stakes; ${Math.round(DUEL.rake * 100)}% of any P coins in the pot are burned. Your stake leaves your pack now and comes back if nobody takes it.`
                  : 'Both players pay their stake into the arena pool wallet on chain once the challenge is taken; the winner is paid the whole pool.'}
              </small>
              <button
                className="btn btn-primary btn-sm bp-wide"
                disabled={busy === 'create'}
                onClick={() =>
                  run(
                    'create',
                    () => {
                      const p = position();
                      return kind === 'soft'
                        ? api.createChallenge('soft', stakeObj(), p.x, p.y)
                        : api.createChallenge('pog', Number(tokens), p.x, p.y);
                    },
                    'Challenge is up.'
                  )
                }
              >
                Put it up
              </button>
            </>
          )}

          <h5>Open challenges</h5>
          {open.length === 0 && <p className="bp-note">Nobody is looking for a fight right now.</p>}
          {open.map((c) => (
            <div className="hm-listing" key={c.id}>
              <div>
                <b>
                  <i className="fish-dot" style={{ background: c.host.color }} /> {c.host.name}
                </b>
                <small>
                  {describeStake(c.stake)} · {shortAddress(c.host.wallet)}
                </small>
              </div>
              {mine?.id === c.id ? (
                <small className="bp-note">yours</small>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy === c.id || !!mine || !canAfford(c.stake)}
                  title={!canAfford(c.stake) ? 'You cannot cover that stake' : undefined}
                  onClick={() =>
                    run(
                      c.id,
                      async () => {
                        const p = position();
                        const { id } = await api.acceptChallenge(c.id, p.x, p.y);
                        onEnter(id);
                      },
                      'Accepted.'
                    )
                  }
                >
                  Fight
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
