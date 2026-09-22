import { useEffect, useState } from 'react';
import { OFFERINGS } from '../../shared/season.js';
import type { Inventory } from '../game/engine';
import { api, type FrostEntry, type SeasonStatus } from '../lib/api';
import { Icon, type IconName } from './Icon';

interface Props {
  guest: boolean;
  inventory: Inventory;
  /** bumped by the engine when something may have moved the ledger */
  refresh: number;
  onOffer: (id: string) => Promise<string | null>;
  onClose: () => void;
}

interface Offering {
  id: string;
  label: string;
  cost: Record<string, number>;
  frost: number;
}

const RES_ICON: Record<string, IconName> = { wood: 'wood', ice: 'ice', fish: 'fish' };

const pct = (n: number) => (n * 100).toFixed(n < 0.001 ? 4 : 2) + '%';
const big = (n: number) => n.toLocaleString('en-US');

/**
 * The season panel: what you have earned toward the airdrop, what is
 * multiplying it, and what is still standing between you and qualifying.
 *
 * It deliberately shows the whole checklist rather than a yes/no — "not
 * eligible" with no explanation is the fastest way to lose a player who
 * was two minutes of playtime away.
 */
export function SeasonPanel({ guest, inventory, refresh, onOffer, onClose }: Props) {
  const [status, setStatus] = useState<SeasonStatus | null>(null);
  const [board, setBoard] = useState<FrostEntry[]>([]);
  const [tab, setTab] = useState<'you' | 'board'>('you');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (guest) return;
    let alive = true;
    const pull = () => {
      api.season().then((s) => alive && setStatus(s)).catch(() => {});
      api.frostBoard().then((b) => alive && setBoard(b.entries)).catch(() => {});
    };
    pull();
    const timer = setInterval(pull, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [guest, refresh]);

  const offer = async (id: string) => {
    setBusy(id);
    setNote('');
    const error = await onOffer(id);
    setNote(error ?? 'Left at the cairn.');
    setBusy('');
    api.season().then(setStatus).catch(() => {});
  };

  const offerings = Object.values(OFFERINGS) as Offering[];
  const affordable = (cost: Record<string, number>) =>
    Object.entries(cost).every(([res, need]) => (inventory[res as keyof Inventory] as number) >= need);

  return (
    <div className="panel side-panel season">
      <div className="bp-head">
        <h4>
          <Icon name="snowflake" size={16} /> {status?.season.name ?? 'Season'}
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      {guest ? (
        <p className="bp-note">
          Frost is credited to a wallet address, and a guest has none. Connect one to start earning
          toward the airdrop.
        </p>
      ) : !status ? (
        <p className="bp-note">Reading the cairn…</p>
      ) : (
        <>
          <div className="bp-tabs">
            <button className={`bp-tab${tab === 'you' ? ' active' : ''}`} onClick={() => setTab('you')}>
              Your Frost
            </button>
            <button className={`bp-tab${tab === 'board' ? ' active' : ''}`} onClick={() => setTab('board')}>
              Board
            </button>
          </div>

          {tab === 'you' && (
            <>
              <div className="sn-hero">
                <b>{big(status.frost)}</b>
                <small>Frost · day {status.season.dayNumber} of {status.season.totalDays}</small>
                <div className="sn-share">
                  {status.pool > 0 ? (
                    <>
                      {pct(status.share)} of the pool ·{' '}
                      <strong>~{big(status.tokens)} $POG</strong>
                    </>
                  ) : (
                    <>Nothing banked yet across the world</>
                  )}
                </div>
                <small className="sn-fine">
                  {status.budgetLabel} is split by share when the season ends in{' '}
                  {status.season.daysLeft} days. The estimate moves as others earn.
                </small>
              </div>

              {!status.gate.ok && (
                <div className="sn-gate">
                  <h5>
                    <Icon name="lock" size={14} /> Not earning yet
                  </h5>
                  {status.gate.items.map((g) => (
                    <div className={`sn-check${g.done ? ' done' : ''}`} key={g.id}>
                      <Icon name={g.done ? 'check' : 'close'} size={13} />
                      <span>{g.label}</span>
                      {g.need != null && !g.done && (
                        <em>
                          {big(g.have ?? 0)}/{big(g.need)}
                        </em>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <h5>Today</h5>
              <div className="q-bar">
                <i style={{ width: `${Math.min(100, (status.frostToday / status.dailyCap) * 100)}%` }} />
              </div>
              <small className="bp-note">
                {status.frostToday} / {status.dailyCap} base Frost banked today.
              </small>

              <h5>Multipliers</h5>
              <div className="sn-mults">
                <div className="sn-mult">
                  <Icon name="fire" size={15} />
                  <span>Streak · {status.multipliers.streak.days}d</span>
                  <b>+{Math.round(status.multipliers.streak.add * 100)}%</b>
                </div>
                <div className={`sn-mult${status.multipliers.igloo.has ? '' : ' off'}`}>
                  <Icon name="igloo" size={15} />
                  <span>Own an igloo</span>
                  <b>+{Math.round(status.multipliers.igloo.add * 100)}%</b>
                </div>
                <div className={`sn-mult${status.multipliers.holder.add ? '' : ' off'}`}>
                  <Icon name="coin" size={15} />
                  <span>Holder · {status.multipliers.holder.label}</span>
                  <b>+{Math.round(status.multipliers.holder.add * 100)}%</b>
                </div>
                <div className="sn-mult total">
                  <span>Everything you earn today</span>
                  <b>×{status.multipliers.total.toFixed(2)}</b>
                </div>
              </div>

              <h5>Offerings</h5>
              <small className="bp-note">
                Burn what you gathered. {status.offerToday} / {status.offerCap} taken today.
              </small>
              {offerings.map((o) => (
                <div className="sn-offer" key={o.id}>
                  <div className="sn-offer-cost">
                    {Object.entries(o.cost).map(([res, need]) => (
                      <span
                        key={res}
                        className={
                          (inventory[res as keyof Inventory] as number) >= need ? '' : 'short'
                        }
                      >
                        <Icon name={RES_ICON[res] ?? 'backpack'} size={14} /> {need}
                      </span>
                    ))}
                  </div>
                  <span className="sn-offer-gain">+{o.frost}</span>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!!busy || !status.gate.ok || !affordable(o.cost)}
                    onClick={() => offer(o.id)}
                  >
                    Offer
                  </button>
                </div>
              ))}
            </>
          )}

          {tab === 'board' && (
            <>
              {board.length === 0 && <p className="bp-note">Nobody has banked Frost yet.</p>}
              {board.map((e) => (
                <div className="lb-row" key={e.rank}>
                  <span className="rank">{e.rank}</span>
                  <span className="dot" style={{ background: e.color, animation: 'none' }} />
                  <span className="nm">{e.name}</span>
                  <span className="amt">{big(e.frost)}</span>
                </div>
              ))}
              <small className="bp-note">
                {status.rank ? `You are #${status.rank}.` : 'You are outside the top 200.'} Shares are
                settled from a snapshot when the season closes.
              </small>
            </>
          )}
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
