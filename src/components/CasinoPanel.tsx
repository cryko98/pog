import { useCallback, useEffect, useRef, useState } from 'react';
import { CASINO, GAMES, RACE, chanceOf, multiplierOf } from '../../shared/casino.js';
import { sound } from '../game/audio';
import { drawBear } from '../game/bear';
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
const LANE_COLOURS = ['#ff5c17', '#38bdf8', '#7cd67c'];
const LANE_NAMES = ['Frost', 'Drift', 'Blizzard'];

/** How long each table takes to show its hand, in ms. */
const FLIP_MS = 1900;
const DICE_MS = 1700;

/**
 * The casino: three tables, P coins only, every roll provably fair.
 *
 * The server committed to today's seed before any bet (its hash is on
 * the panel), the player adds a seed of their own, and yesterday's seed
 * is shown in the clear so any bet from yesterday can be recomputed.
 *
 * The hand is settled the moment the server answers; what follows on
 * screen is theatre that lands on that answer — the coin comes down on
 * the face the server drew, the dice stop on its number, and the race is
 * run leg by leg on the paces the server rolled.
 */
export function CasinoPanel({ guest, inventory, position, onChanged, onClose }: Props) {
  const [state, setState] = useState<CasinoState | null>(null);
  const [game, setGame] = useState<GameId>('flip');
  const [choice, setChoice] = useState<Record<GameId, string>>({ flip: 'ice', dice: '40', race: '1' });
  const [wager, setWager] = useState('10');
  const [clientSeed, setClientSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  /** the hand being shown, and whether the theatre has landed yet */
  const [hand, setHand] = useState<{ bet: CasinoBet; landed: boolean } | null>(null);
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
  const chance = chanceOf(game, pick);
  const showing = !!hand && !hand.landed;
  const canBet = !guest && !busy && !showing && amount >= CASINO.minWager && amount <= CASINO.maxWager && amount <= inventory.pog;

  const land = useCallback(
    (bet: CasinoBet) => {
      if (!alive.current) return;
      setHand({ bet, landed: true });
      if (bet.won) sound.win();
      else sound.lose();
      onChanged();
      reload();
    },
    [onChanged, reload]
  );

  const play = async () => {
    if (!canBet) return;
    setBusy(true);
    setNote('');
    try {
      const p = position();
      const { bet } = await api.bet(game, pick, amount, clientSeed, p.x, p.y);
      if (!alive.current) return;
      setHand({ bet, landed: false });
      sound.click();
      if (bet.game === 'flip') setTimeout(() => land(bet), FLIP_MS);
      else if (bet.game === 'dice') setTimeout(() => land(bet), DICE_MS);
      // the race lands itself when the last bear crosses the line
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The table would not take it.');
      sound.error();
    }
    if (alive.current) setBusy(false);
  };

  const g = GAMES[game];
  const shown = hand && hand.bet.game === game ? hand : null;

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
            P coins only — never the token. The house keeps {Math.round(CASINO.edge * 100)}% of the fair odds and
            burns it; every table wins less than half its hands. Wager {CASINO.minWager}–{big(CASINO.maxWager)} a
            hand.
          </p>

          <div className="bp-tabs">
            {(Object.keys(GAMES) as GameId[]).map((id) => (
              <button key={id} className={`bp-tab${game === id ? ' active' : ''}`} disabled={showing} onClick={() => setGame(id)}>
                {GAMES[id].label}
              </button>
            ))}
          </div>
          <p className="bp-note">{g.blurb}</p>

          {game === 'flip' && <FlipTable hand={shown} choice={pick} />}
          {game === 'dice' && <DiceTable hand={shown} choice={pick} />}
          {game === 'race' && <RaceTable hand={shown} choice={pick} onDone={land} />}

          {shown?.landed && (
            <div className={`cs-result ${shown.bet.won ? 'won' : 'lost'}`}>
              <b className="with-icon">
                <Icon name="coin" size={16} /> {shown.bet.won ? `+${big(shown.bet.paid - shown.bet.wager)}` : `−${big(shown.bet.wager)}`} P coins
              </b>
              <small>
                {shown.bet.game === 'dice'
                  ? `rolled ${shown.bet.shown}, you needed under ${shown.bet.choice}`
                  : shown.bet.game === 'race'
                    ? `${LANE_NAMES[Number(shown.bet.shown) - 1]} took it, you had ${LANE_NAMES[Number(shown.bet.choice) - 1]}`
                    : shown.bet.shown === 'melt'
                      ? 'it melted — nobody wins that one'
                      : `it was ${shown.bet.shown}, you said ${shown.bet.choice}`}{' '}
                · hand #{shown.bet.nonce}
              </small>
            </div>
          )}

          <div className="cs-choices">
            {game === 'flip' &&
              g.choices!.map((c) => (
                <button key={c} className={`duel-btn${pick === c ? ' active' : ''}`} disabled={showing} onClick={() => setChoice((p) => ({ ...p, flip: c }))}>
                  {c === 'ice' ? '❄ Ice' : '🔥 Fire'}
                </button>
              ))}
            {game === 'race' &&
              g.choices!.map((c, i) => (
                <button
                  key={c}
                  className={`duel-btn cs-lane${pick === c ? ' active' : ''}`}
                  disabled={showing}
                  style={{ ['--lane' as string]: LANE_COLOURS[i] }}
                  onClick={() => setChoice((p) => ({ ...p, race: c }))}
                >
                  <i /> {LANE_NAMES[i]}
                </button>
              ))}
            {game === 'dice' && (
              <label className="cs-slider">
                <span>
                  Under <b>{pick}</b> · {Number(pick)}% to win · pays {mult}×
                </span>
                <input
                  type="range"
                  min={2}
                  max={CASINO.diceMax}
                  value={Number(pick)}
                  disabled={showing}
                  onChange={(e) => setChoice((p) => ({ ...p, dice: e.target.value }))}
                />
              </label>
            )}
          </div>

          <div className="cs-bet">
            <label>
              <span className="with-icon">
                <Icon name="coin" size={13} /> Wager, in P coins
              </span>
              <span className="cs-wager">
                <Icon name="coin" size={18} />
                <input inputMode="numeric" value={wager} disabled={showing} onChange={(e) => setWager(e.target.value.replace(/[^\d]/g, ''))} />
              </span>
            </label>
            <div className="cs-quick">
              {[10, 50, 200].map((n) => (
                <button key={n} className="duel-btn" disabled={showing} onClick={() => setWager(String(n))}>
                  {n}
                </button>
              ))}
              <button className="duel-btn" disabled={showing} onClick={() => setWager(String(Math.min(CASINO.maxWager, inventory.pog)))}>
                max
              </button>
            </div>
            <button className="btn btn-primary bp-wide" disabled={!canBet} onClick={() => void play()}>
              {showing
                ? game === 'race'
                  ? 'They’re off…'
                  : game === 'flip'
                    ? 'In the air…'
                    : 'Rolling…'
                : (
                    <>
                      Bet <Icon name="coin" size={15} /> {big(amount)} to win <Icon name="coin" size={15} /> {big(Math.floor(amount * mult))}
                    </>
                  )}
            </button>
            <small className="bp-note">
              {Math.round(chance * 100)}% to win, pays {mult}×. You have <Icon name="coin" size={12} /> {big(inventory.pog)} P coins.
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
                    Roll = HMAC-SHA256(seed, wallet:day:nonce:yourSeed); the first 13 hex digits ÷ 2⁵² are the number, and
                    the race runs on the digest's bytes. Your next hand is #{state.nonce + 1}.
                  </small>
                  <label>
                    <span>Your seed</span>
                    <input value={clientSeed} maxLength={32} disabled={showing} onChange={(e) => setClientSeed(e.target.value.replace(/[^\w.-]/g, ''))} />
                  </label>
                  {state.reveal ? (
                    <small>
                      Yesterday ({state.reveal.day}) the seed was <code>{state.reveal.seed.slice(0, 24)}…</code> — fetch the
                      whole thing at <code>/api/casino/reveal?day={state.reveal.day}</code> and check any hand from that day.
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
                          {b.game === 'race' ? LANE_NAMES[Number(b.choice) - 1] : b.choice} → {b.game === 'race' ? LANE_NAMES[Number(b.shown) - 1] : b.shown}
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

/* ------------------------------------------------------------------ *
 * The flip: a coin in the air that comes down on the face the server
 * drew — or melts, which beats both calls.
 * ------------------------------------------------------------------ */

function FlipTable({ hand, choice }: { hand: { bet: CasinoBet; landed: boolean } | null; choice: string }) {
  const flying = !!hand && !hand.landed;
  const face = hand?.landed ? hand.bet.shown : null;
  return (
    <div className={`cs-table cs-flip${face ? (hand!.bet.won ? ' won' : ' lost') : ''}`}>
      <div className={`cs-coin${flying ? ' flying' : ''}${face === 'melt' ? ' melt' : ''}`} data-face={face ?? choice}>
        <div className="cs-coin-face ice">❄</div>
        <div className="cs-coin-face fire">🔥</div>
      </div>
      {face === 'melt' && <div className="cs-drips" aria-hidden />}
      <small>{flying ? 'Up it goes…' : face ? (face === 'melt' ? 'Melted.' : face === 'ice' ? 'Ice.' : 'Fire.') : `You call ${choice}.`}</small>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dice: two blocks of ice, tens and ones, that tumble and stop on
 * the server's number.
 * ------------------------------------------------------------------ */

function DiceTable({ hand, choice }: { hand: { bet: CasinoBet; landed: boolean } | null; choice: string }) {
  const rolling = !!hand && !hand.landed;
  const [shown, setShown] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    if (!rolling) {
      if (hand?.landed) {
        const n = Number(hand.bet.shown);
        setShown([Math.floor(n / 10), n % 10]);
      }
      return;
    }
    const t = setInterval(() => setShown([Math.floor(Math.random() * 10), Math.floor(Math.random() * 10)]), 70);
    return () => clearInterval(t);
  }, [rolling, hand]);
  const landed = hand?.landed ? hand.bet : null;
  return (
    <div className={`cs-table cs-dice${landed ? (landed.won ? ' won' : ' lost') : ''}`}>
      <div className="cs-dice-row">
        <div className={`cs-die${rolling ? ' rolling' : ''}`}>{shown[0]}</div>
        <div className={`cs-die${rolling ? ' rolling alt' : ''}`}>{shown[1]}</div>
      </div>
      <div className="cs-dice-bar">
        <i style={{ width: `${Number(landed ? landed.choice : choice)}%` }} />
        {landed && <b style={{ left: `${Math.min(99, Number(landed.shown))}%` }} />}
      </div>
      <small>{rolling ? 'Tumbling…' : landed ? `Rolled ${landed.shown}.` : `Under ${choice} wins.`}</small>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The race: three polar bears run the track on the paces the server
 * rolled, leg by leg, and the first over the line is the winner the
 * server already settled on. Drawn on a canvas at 60 frames.
 * ------------------------------------------------------------------ */

function RaceTable({ hand, choice, onDone }: { hand: { bet: CasinoBet; landed: boolean } | null; choice: string; onDone: (bet: CasinoBet) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef<number | null>(null);
  const finished = useRef(false);
  const running = !!hand && !hand.landed && !!hand.bet.race;
  const race = hand?.bet.race ?? null;

  useEffect(() => {
    if (running) {
      startedAt.current = null;
      finished.current = false;
      sound.growl();
    }
  }, [running, hand]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    let raf = 0;
    const GATE_MS = 900;

    /** where a bear is, in track units, `t` seconds into its run */
    const distanceAt = (paces: number[], t: number) => {
      const leg = RACE.length / RACE.legs;
      let d = 0;
      let left = t;
      for (const pace of paces) {
        const legTime = leg / pace;
        if (left <= legTime) return d + pace * left;
        d += leg;
        left -= legTime;
      }
      return RACE.length;
    };

    const draw = (pnow: number) => {
      raf = requestAnimationFrame(draw);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (el.width !== w * devicePixelRatio || el.height !== h * devicePixelRatio) {
        el.width = w * devicePixelRatio;
        el.height = h * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      // the track: three lanes of packed snow, a gate and a line
      const laneH = h / RACE.lanes;
      const bearH = laneH * 0.78;
      const startX = 14 + bearH * 0.9;
      const finishX = w - 22;
      ctx.fillStyle = '#0b1a26';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < RACE.lanes; i++) {
        ctx.fillStyle = i % 2 ? '#dbeefb' : '#cfe6f6';
        ctx.fillRect(0, i * laneH, w, laneH);
        ctx.fillStyle = LANE_COLOURS[i];
        ctx.fillRect(0, i * laneH, 6, laneH);
        ctx.fillStyle = 'rgba(13,43,58,0.55)';
        ctx.font = `800 ${Math.max(9, laneH * 0.28)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(LANE_NAMES[i], 11, i * laneH + laneH * 0.5);
      }
      ctx.strokeStyle = 'rgba(13,43,58,0.25)';
      ctx.lineWidth = 1;
      for (let i = 1; i < RACE.lanes; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * laneH);
        ctx.lineTo(w, i * laneH);
        ctx.stroke();
      }
      // checkered line
      for (let y = 0; y < h; y += 6) {
        ctx.fillStyle = Math.floor(y / 6) % 2 ? '#0d2b3a' : '#ffffff';
        ctx.fillRect(finishX, y, 6, 6);
      }

      let t = 0;
      let gateOpen = false;
      if (running && race) {
        if (startedAt.current === null) startedAt.current = pnow;
        const since = pnow - startedAt.current;
        gateOpen = since >= GATE_MS;
        t = Math.max(0, (since - GATE_MS) / 1000);
      }
      // the gate: down until they're off
      if (running && !gateOpen) {
        ctx.fillStyle = '#4e321c';
        ctx.fillRect(startX + bearH * 0.35, 0, 4, h);
      }

      const order: number[] = [];
      for (let i = 0; i < RACE.lanes; i++) {
        const paces = race?.paces[i] ?? [];
        const dist = running && race && gateOpen ? distanceAt(paces, t) : hand?.landed && race ? RACE.length : 0;
        const done = race ? (running ? t >= race.times[i] : true) : false;
        const x = startX + (dist / RACE.length) * (finishX - startX - bearH * 0.4);
        const moving = running && gateOpen && !done;
        drawBear(ctx, x, (i + 1) * laneH - laneH * 0.1, bearH, pnow, moving, -1, 1, 1);
        // snow kicked up behind a running bear
        if (moving) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          for (let k = 0; k < 3; k++) {
            const px = x - bearH * 0.7 - ((pnow / 30 + k * 17) % 22);
            ctx.beginPath();
            ctx.arc(px, (i + 1) * laneH - laneH * 0.14 - (k % 2) * 4, 2 + (k % 2), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (race && done) order.push(i);
      }
      // the chosen lane, marked
      const mine = Number(choice) - 1;
      if (mine >= 0) {
        ctx.fillStyle = LANE_COLOURS[mine];
        ctx.beginPath();
        ctx.moveTo(w - 12, mine * laneH + 4);
        ctx.lineTo(w - 4, mine * laneH + 4);
        ctx.lineTo(w - 8, mine * laneH + 11);
        ctx.closePath();
        ctx.fill();
      }
      // a ribbon on the winner once it is over
      if (race && (hand?.landed || (running && t >= Math.min(...race.times)))) {
        const win = Number(race.winner) - 1;
        ctx.fillStyle = '#ffd44d';
        ctx.font = `800 ${Math.max(10, laneH * 0.3)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeText('WINNER', finishX - 8, win * laneH + laneH * 0.5);
        ctx.fillText('WINNER', finishX - 8, win * laneH + laneH * 0.5);
      }
      // everybody home: the hand lands
      if (running && race && !finished.current && t >= Math.max(...race.times) + 0.4) {
        finished.current = true;
        onDone(hand!.bet);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, race, hand, choice, onDone]);

  const landed = hand?.landed ? hand.bet : null;
  return (
    <div className={`cs-table cs-race${landed ? (landed.won ? ' won' : ' lost') : ''}`}>
      <canvas ref={canvas} className="cs-track" />
      <small>
        {running
          ? 'They’re off!'
          : landed && landed.race
            ? `${LANE_NAMES[Number(landed.race.winner) - 1]} by ${Math.abs(landed.race.times[Number(landed.race.winner) - 1] - [...landed.race.times].sort((a, b) => a - b)[1]).toFixed(2)}s.`
            : `Your bear: ${LANE_NAMES[Number(choice) - 1]}. Each runs ${RACE.legs} legs at its own pace.`}
      </small>
    </div>
  );
}
