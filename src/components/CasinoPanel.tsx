import { useCallback, useEffect, useRef, useState } from 'react';
import { CASINO, GAMES, multiplierOf } from '../../shared/casino.js';
import { sound } from '../game/audio';
import type { Inventory } from '../game/engine';
import { api, type CasinoBet, type CasinoState } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  guest: boolean;
  inventory: Inventory;
  /** where the player stands, for the casino's position check */
  position: () => { x: number; y: number };
  /** the balance changed — let the world re-read it */
  onChanged: () => void;
  onClose: () => void;
}

type GameId = 'flip' | 'dice' | 'race';
const big = (n: number) => n.toLocaleString('en-US');
const FACE: Record<string, string> = { ice: '❄', fire: '🔥', '1': '🐻¹', '2': '🐻²', '3': '🐻³' };

/**
 * The casino: three tables, P coins only, every roll provably fair.
 *
 * The server committed to today's seed before any bet (its hash is on
 * the panel), the player adds a seed of their own, and yesterday's seed
 * is shown in the clear so any bet from yesterday can be recomputed.
 */
export function CasinoPanel({ guest, inventory, position, onChanged, onClose }: Props) {
  const [state, setState] = useState<CasinoState | null>(null);
  const [game, setGame] = useState<GameId>('flip');
  const [choice, setChoice] = useState<Record<GameId, string>>({ flip: 'ice', dice: '50', race: '1' });
  const [wager, setWager] = useState('10');
  const [clientSeed, setClientSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [last, setLast] = useState<CasinoBet | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [showFair, setShowFair] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    if (guest) return;
    api.casino().then((s) => alive.current && setState(s)).catch(() => {});
  }, [guest]);

  useEffect(() => {
    reload();
  }, [reload]);

  const pick = choice[game];
  const amount = Math.floor(Number(wager) || 0);
  const mult = multiplierOf(game, pick);
  const canBet = !guest && !busy && !spinning && amount >= CASINO.minWager && amount <= CASINO.maxWager && amount <= inventory.pog;

  const play = async () => {
    if (!canBet) return;
    setBusy(true);
    setNote('');
    setSpinning(true);
    try {
      const p = position();
      const { bet } = await api.bet(game, pick, amount, clientSeed, p.x, p.y);
      // let the table turn for a beat before it lands
      await new Promise((r) => setTimeout(r, 700));
      if (!alive.current) return;
      setLast(bet);
      if (bet.won) sound.win();
      else sound.lose();
      onChanged();
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The table would not take it.');
      sound.error();
    }
    if (alive.current) {
      setSpinning(false);
      setBusy(false);
    }
  };

  const g = GAMES[game];

  return (
    <div className="panel side-panel casino">
      <div className="bp-head">
        <h4>
          <Icon name="dice" size={16} /> Casino
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      {guest ? (
        <p className="bp-note">The tables take P coins, and P coins belong to a wallet. Connect one to play.</p>
      ) : (
        <>
          <p className="bp-note">
            P coins only — never the token. The house keeps {Math.round(CASINO.edge * 100)}% of the fair
            odds and burns it. Wager {CASINO.minWager}–{big(CASINO.maxWager)} a hand.
          </p>

          <div className="bp-tabs">
            {(Object.keys(GAMES) as GameId[]).map((id) => (
              <button key={id} className={`bp-tab${game === id ? ' active' : ''}`} onClick={() => setGame(id)}>
                {GAMES[id].label}
              </button>
            ))}
          </div>
          <p className="bp-note">{g.blurb}</p>

          <div className={`cs-table${spinning ? ' spinning' : ''}${last && !spinning ? (last.won ? ' won' : ' lost') : ''}`}>
            {spinning ? (
              <div className="cs-face cs-spin">{game === 'dice' ? '…' : game === 'flip' ? '❄' : '🐻'}</div>
            ) : last && last.game === game ? (
              <>
                <div className="cs-face">{FACE[last.shown] ?? last.shown}</div>
                <b>{last.won ? `+${big(last.paid - last.wager)} P coins` : `−${big(last.wager)} P coins`}</b>
                <small>
                  {last.game === 'dice' ? `rolled ${last.shown}, you needed under ${last.choice}` : `it was ${last.shown}, you said ${last.choice}`} ·
                  bet #{last.nonce}
                </small>
              </>
            ) : (
              <div className="cs-face idle">{game === 'dice' ? '🎲' : game === 'flip' ? '❄' : '🐻'}</div>
            )}
          </div>

          <div className="cs-choices">
            {g.choices ? (
              g.choices.map((c) => (
                <button key={c} className={`duel-btn${pick === c ? ' active' : ''}`} onClick={() => setChoice((p) => ({ ...p, [game]: c }))}>
                  {c === 'ice' ? '❄ Ice' : c === 'fire' ? '🔥 Fire' : `Bear ${c}`}
                </button>
              ))
            ) : (
              <label className="cs-slider">
                <span>
                  Under <b>{pick}</b> · {Math.max(0, Number(pick))}% to win · pays {mult}×
                </span>
                <input type="range" min={2} max={96} value={Number(pick)} onChange={(e) => setChoice((p) => ({ ...p, dice: e.target.value }))} />
              </label>
            )}
          </div>

          <div className="cs-bet">
            <label>
              <span>Wager</span>
              <input inputMode="numeric" value={wager} onChange={(e) => setWager(e.target.value.replace(/[^\d]/g, ''))} />
            </label>
            <div className="cs-quick">
              {[10, 50, 200].map((n) => (
                <button key={n} className="duel-btn" onClick={() => setWager(String(n))}>
                  {n}
                </button>
              ))}
              <button className="duel-btn" onClick={() => setWager(String(Math.min(CASINO.maxWager, inventory.pog)))}>
                max
              </button>
            </div>
            <button className="btn btn-primary bp-wide" disabled={!canBet} onClick={() => void play()}>
              {spinning ? 'Rolling…' : `Bet ${big(amount)} to win ${big(Math.floor(amount * mult))}`}
            </button>
            <small className="bp-note">
              You have {big(inventory.pog)} P coins.
              {amount > inventory.pog ? ' Not enough for that wager.' : ''}
            </small>
          </div>

          {note && <p className="bp-feedback">{note}</p>}

          {state && (
            <>
              <button className="cs-fair-toggle" onClick={() => setShowFair((v) => !v)}>
                <Icon name="lock" size={12} /> Provably fair {showFair ? '▾' : '▸'}
              </button>
              {showFair && (
                <div className="cs-fair">
                  <small>
                    Today's seed is committed before you bet: <code>{state.commit.slice(0, 24)}…</code>
                  </small>
                  <small>
                    Roll = HMAC-SHA256(seed, wallet:day:nonce:yourSeed), first 13 hex digits ÷ 2⁵². Your next bet is #
                    {state.nonce + 1}.
                  </small>
                  <label>
                    <span>Your seed</span>
                    <input value={clientSeed} maxLength={32} onChange={(e) => setClientSeed(e.target.value.replace(/[^\w.-]/g, ''))} />
                  </label>
                  {state.reveal ? (
                    <small>
                      Yesterday ({state.reveal.day}) the seed was <code>{state.reveal.seed.slice(0, 24)}…</code> — fetch the
                      whole thing at <code>/api/casino/reveal?day={state.reveal.day}</code> and check any bet from that day.
                    </small>
                  ) : (
                    <small>Yesterday's seed appears here once the table has been open for a day.</small>
                  )}
                  <small>
                    Today across every table: {big(state.today.wagered)} wagered, {big(state.today.paid)} paid out.
                  </small>
                </div>
              )}

              {state.recent.length > 0 && (
                <>
                  <h5>Your last hands</h5>
                  <div className="cs-log">
                    {state.recent.slice(0, 8).map((b) => (
                      <div key={`${b.day}:${b.nonce}`} className={b.won ? 'won' : 'lost'}>
                        <span>{GAMES[b.game].label}</span>
                        <span>
                          {b.choice} → {b.shown}
                        </span>
                        <b>{b.won ? `+${big(b.paid - b.wager)}` : `−${big(b.wager)}`}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
