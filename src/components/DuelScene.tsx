import { useCallback, useEffect, useRef, useState } from 'react';
import { LANES, commitHash } from '../../shared/duel.js';
import { blitPenguin } from '../game/penguin';
import { api, type DuelChoice, type DuelView } from '../lib/api';
import { canSendTransactions, signAndSendTransaction } from '../lib/wallet';
import { useSession } from '../state/session';
import { describeStake } from './ArenaPanel';
import { Icon } from './Icon';

interface Props {
  id: string;
  onLeave: () => void;
}

const LANE_X = [0.25, 0.5, 0.75];
const laneIndex = (lane: string) => Math.max(0, LANES.indexOf(lane));
const ANIM_MS = 2200;
const randomNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

interface Sealed {
  volley: number;
  choice: DuelChoice;
  nonce: string;
}

/**
 * The duel screen. Everything the server decided is drawn; everything the
 * player decides is sealed before it is sent.
 *
 * Each volley: pick where to throw (a lane, high or low) and how to dodge
 * (a lane, and whether to jump). The choice is hashed and the hash sent
 * while the clock runs; once both sides have sealed, the choice itself is
 * sent, the server checks it against the hash, resolves both throws, and
 * the volley plays out on the rink from the server's verdict.
 */
export function DuelScene({ id, onLeave }: Props) {
  const { connected, identity } = useSession();
  const [view, setView] = useState<DuelView | null>(null);
  const [error, setError] = useState('');
  const [throwLane, setThrowLane] = useState<string | null>(null);
  const [throwHeight, setThrowHeight] = useState<'low' | 'high'>('low');
  const [dodgeLane, setDodgeLane] = useState('centre');
  const [jump, setJump] = useState(false);
  const [paying, setPaying] = useState(false);
  const sealed = useRef<Sealed | null>(null);
  const sealing = useRef(false);
  const revealing = useRef(false);
  const anim = useRef<{ at: number; index: number } | null>(null);
  const shownVolleys = useRef(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clockSkew = useRef(0);
  const viewRef = useRef<DuelView | null>(null);
  const choiceRef = useRef({ throwLane, throwHeight, dodgeLane, jump });
  choiceRef.current = { throwLane, throwHeight, dodgeLane, jump };

  /* ---------------- polling ---------------- */

  const refresh = useCallback(async () => {
    try {
      const { match } = await api.duel(id);
      if (!match) return;
      clockSkew.current = match.serverNow - Date.now();
      viewRef.current = match;
      setView(match);
      if (match.history.length > shownVolleys.current) {
        anim.current = { at: performance.now(), index: match.history.length - 1 };
        shownVolleys.current = match.history.length;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lost the arena.');
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 650);
    return () => clearInterval(t);
  }, [refresh]);

  const serverNow = () => Date.now() + clockSkew.current;

  /* ---------------- sealing and opening ---------------- */

  const seal = useCallback(async () => {
    const v = viewRef.current;
    if (!v || v.state !== 'live' || v.phase !== 'commit' || v.me.committed || sealing.current) return;
    sealing.current = true;
    const c = choiceRef.current;
    const choice: DuelChoice = {
      throwLane: c.throwLane ?? 'centre',
      throwHeight: c.throwHeight,
      dodgeLane: c.dodgeLane,
      jump: c.jump,
    };
    const nonce = randomNonce();
    try {
      const hash = await commitHash(choice, nonce);
      sealed.current = { volley: v.volley, choice, nonce };
      const { match } = await api.duelCommit(v.id, hash);
      viewRef.current = match;
      setView(match);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not throw.');
    } finally {
      sealing.current = false;
    }
  }, []);

  // open the sealed choice as soon as the server is in the reveal half
  useEffect(() => {
    const v = view;
    const s = sealed.current;
    if (!v || v.state !== 'live' || v.phase !== 'reveal' || !v.me.committed || v.me.revealed) return;
    if (!s || s.volley !== v.volley || revealing.current) return;
    revealing.current = true;
    api
      .duelReveal(v.id, s.choice, s.nonce)
      .then(({ match }) => {
        viewRef.current = match;
        setView(match);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not reveal.'))
      .finally(() => {
        revealing.current = false;
      });
  }, [view]);

  // seal automatically just before the clock runs out, so a slow hand is
  // never a strike — and reset the throw for the next volley
  useEffect(() => {
    if (!view || view.state !== 'live') return;
    if (view.phase === 'commit' && !view.me.committed) {
      const left = view.phaseEndsAt - serverNow();
      const t = setTimeout(() => void seal(), Math.max(0, left - 900));
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.volley, view?.phase, view?.me.committed, view?.state]);

  useEffect(() => {
    setThrowLane(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.volley]);

  /* ---------------- keys ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.code;
      const idx = laneIndex(choiceRef.current.dodgeLane);
      if (k === 'KeyA' || k === 'ArrowLeft') setDodgeLane(LANES[Math.max(0, idx - 1)]);
      else if (k === 'KeyD' || k === 'ArrowRight') setDodgeLane(LANES[Math.min(2, idx + 1)]);
      else if (k === 'KeyW' || k === 'ArrowUp' || k === 'Space') setJump((j) => !j);
      else if (k === 'Digit1') setThrowLane('left');
      else if (k === 'Digit2') setThrowLane('centre');
      else if (k === 'Digit3') setThrowLane('right');
      else if (k === 'KeyQ') setThrowHeight('high');
      else if (k === 'KeyE') setThrowHeight('low');
      else if (k === 'Enter') void seal();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seal]);

  /* ---------------- the rink ---------------- */

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d')!;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = viewRef.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * devicePixelRatio || el.height !== h * devicePixelRatio) {
        el.width = w * devicePixelRatio;
        el.height = h * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      // packed snow, lanes, centre line
      ctx.fillStyle = '#dbeefb';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(120,170,205,0.35)';
      ctx.lineWidth = 2;
      for (const lx of LANE_X) {
        ctx.beginPath();
        ctx.moveTo(lx * w, h * 0.08);
        ctx.lineTo(lx * w, h * 0.92);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,170,205,0.6)';
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(w * 0.08, h / 2);
      ctx.lineTo(w * 0.92, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const c = choiceRef.current;
      const scale = Math.min(1.1, Math.max(0.7, h / 620));
      const pengH = 84 * scale;

      // where each penguin stands and whether it is in the air
      let myLane = laneIndex(c.dodgeLane);
      let theirLane = 1;
      let myAir = 0;
      let theirAir = 0;
      let ball: { from: number; to: number; high: boolean; t: number; mine: boolean }[] = [];
      let flash: { mine: boolean; t: number } | null = null;

      const a = anim.current;
      const last = a && v?.history[a.index];
      if (a && last) {
        const t = Math.min(1, (performance.now() - a.at) / ANIM_MS);
        if (t >= 1) anim.current = null;
        const mine = last.mine;
        const theirs = last.theirs;
        if (mine) myLane = laneIndex(mine.dodgeLane);
        if (theirs) theirLane = laneIndex(theirs.dodgeLane);
        const hop = (jumpNow: boolean) => (jumpNow ? Math.sin(Math.min(1, Math.max(0, (t - 0.35) / 0.35)) * Math.PI) * 46 * scale : 0);
        myAir = hop(!!mine?.jump);
        theirAir = hop(!!theirs?.jump);
        const flight = Math.min(1, Math.max(0, (t - 0.15) / 0.5));
        if (mine) ball.push({ from: myLane, to: laneIndex(mine.throwLane), high: mine.throwHeight === 'high', t: flight, mine: true });
        if (theirs) ball.push({ from: theirLane, to: laneIndex(theirs.throwLane), high: theirs.throwHeight === 'high', t: flight, mine: false });
        if (t > 0.65 && t < 0.95) {
          if (last.theirHits) flash = { mine: true, t };
          if (last.myHits) flash = { mine: false, t };
        }
      } else if (v?.state === 'live' && v.phase === 'commit' && !v.me.committed) {
        myAir = c.jump ? 10 * scale : 0;
      }

      const themY = h * 0.26;
      const meY = h * 0.84;

      // the throw target, shown on their side while we are choosing
      if (v?.state === 'live' && v.phase === 'commit' && !v.me.committed && c.throwLane) {
        const tx = LANE_X[laneIndex(c.throwLane)] * w;
        const ty = themY - (c.throwHeight === 'high' ? pengH * 0.75 : pengH * 0.2);
        ctx.strokeStyle = 'rgba(255,92,23,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tx, ty, 18 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,92,23,0.9)';
        ctx.fill();
      }

      // shadows
      for (const [lx, y, air] of [
        [LANE_X[theirLane], themY, theirAir],
        [LANE_X[myLane], meY, myAir],
      ] as Array<[number, number, number]>) {
        ctx.fillStyle = 'rgba(56,92,120,0.25)';
        ctx.beginPath();
        ctx.ellipse(lx * w, y, 22 * scale * (1 - air / 200), 8 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // penguins
      const themColor = v?.them?.color ?? '#38bdf8';
      const meColor = identity?.color ?? v?.me.color ?? '#ff6b2c';
      blitPenguin(ctx, themColor, 'down', 0, false, LANE_X[theirLane] * w, themY - theirAir, pengH);
      blitPenguin(ctx, meColor, 'up', 0, false, LANE_X[myLane] * w, meY - myAir, pengH);

      // snowballs in flight
      for (const b of ball) {
        const fromY = b.mine ? meY - pengH * 0.5 : themY - pengH * 0.5;
        const toY = b.mine ? themY - (b.high ? pengH * 0.75 : pengH * 0.2) : meY - (b.high ? pengH * 0.75 : pengH * 0.2);
        const x = (LANE_X[b.from] + (LANE_X[b.to] - LANE_X[b.from]) * b.t) * w;
        const y = fromY + (toY - fromY) * b.t - Math.sin(b.t * Math.PI) * (b.high ? 90 : 30) * scale;
        ctx.fillStyle = 'rgba(56,92,120,0.2)';
        ctx.beginPath();
        ctx.ellipse(x, fromY + (toY - fromY) * b.t + 6, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(150,190,215,0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, 9 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // the splat
      if (flash) {
        const x = LANE_X[flash.mine ? myLane : theirLane] * w;
        const y = (flash.mine ? meY - myAir : themY - theirAir) - pengH * 0.5;
        const k = (flash.t - 0.65) / 0.3;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * (14 + k * 30) * scale, y + Math.sin(ang) * (10 + k * 22) * scale, (5 - k * 3) * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff5c17';
        ctx.font = `800 ${Math.round(26 * scale)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('HIT!', x, y - (30 + k * 20) * scale);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [identity?.color]);

  /* ---------------- real stakes ---------------- */

  const payStake = async () => {
    if (!view || !connected) return;
    if (!canSendTransactions(connected)) {
      setError('This wallet can sign messages but not send transactions.');
      return;
    }
    setPaying(true);
    setError('');
    try {
      const { transaction } = await api.duelInvoice(view.id);
      const signature = await signAndSendTransaction(connected, transaction);
      for (let i = 0; i < 40; i++) {
        const r = await api.duelDeposit(view.id, signature);
        if (!r.pending) break;
        await new Promise((res) => setTimeout(res, 3000));
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payment did not go through.');
    }
    setPaying(false);
  };

  /* ---------------- the frame around the rink ---------------- */

  const live = view?.state === 'live';
  const choosing = live && view!.phase === 'commit' && !view!.me.committed;
  const left = view ? Math.max(0, view.phaseEndsAt - serverNow()) : 0;
  const clockMs = view ? (view.phase === 'commit' ? view.rules.commitMs : view.rules.revealMs) : 1;
  const over = view?.state === 'done' || view?.state === 'cancelled';

  return (
    <div className="duel">
      <canvas
        ref={canvas}
        className="duel-rink"
        onClick={(e) => {
          if (!choosing) return;
          const r = e.currentTarget.getBoundingClientRect();
          const fx = (e.clientX - r.left) / r.width;
          const fy = (e.clientY - r.top) / r.height;
          const lane = LANES[fx < 0.375 ? 0 : fx < 0.625 ? 1 : 2];
          if (fy < 0.5) {
            setThrowLane(lane);
            setThrowHeight(fy < 0.2 ? 'high' : 'low');
          } else {
            setDodgeLane(lane);
          }
        }}
      />

      <div className="duel-top">
        <div className="duel-side">
          <b style={{ color: view?.them?.color }}>{view?.them?.name ?? '…'}</b>
          <span>{view?.them?.hits ?? 0}</span>
        </div>
        <div className="duel-mid">
          {view && live && (
            <>
              <small>
                Volley {view.volley + 1}
                {view.volley + 1 > view.rules.volleys ? ' · sudden death' : ` / ${view.rules.volleys}`}
              </small>
              <div className="duel-clock">
                <i style={{ width: `${Math.min(100, (left / clockMs) * 100)}%` }} />
              </div>
              <small>
                {view.phase === 'commit'
                  ? view.me.committed
                    ? view.them?.committed
                      ? 'Both sealed'
                      : 'Sealed — waiting for them'
                    : 'Choose and seal'
                  : 'Revealing…'}
              </small>
            </>
          )}
          {view?.state === 'funding' && <small>Paying the stakes</small>}
          {over && <small>{view?.reason}</small>}
        </div>
        <div className="duel-side me">
          <b style={{ color: identity?.color }}>{view?.me.name ?? 'You'}</b>
          <span>{view?.me.hits ?? 0}</span>
        </div>
      </div>

      {view && <div className="duel-stake">Pot: {describeStake(view.stake)} × 2</div>}

      {choosing && (
        <div className="duel-controls">
          <div className="duel-group">
            <small>Throw</small>
            {LANES.map((l) => (
              <button key={l} className={`duel-btn${throwLane === l ? ' active' : ''}`} onClick={() => setThrowLane(l)}>
                {l}
              </button>
            ))}
            <button className={`duel-btn${throwHeight === 'high' ? ' active' : ''}`} onClick={() => setThrowHeight('high')}>
              high
            </button>
            <button className={`duel-btn${throwHeight === 'low' ? ' active' : ''}`} onClick={() => setThrowHeight('low')}>
              low
            </button>
          </div>
          <div className="duel-group">
            <small>Dodge</small>
            {LANES.map((l) => (
              <button key={l} className={`duel-btn${dodgeLane === l ? ' active' : ''}`} onClick={() => setDodgeLane(l)}>
                {l}
              </button>
            ))}
            <button className={`duel-btn${jump ? ' active' : ''}`} onClick={() => setJump((j) => !j)}>
              jump
            </button>
          </div>
          <button className="btn btn-primary duel-seal" disabled={!throwLane} onClick={() => void seal()}>
            <Icon name="hand" size={16} /> Throw!
          </button>
          <small className="duel-keys">1 2 3 lane · Q high / E low · A D stand · W jump · Enter throw</small>
        </div>
      )}

      {view?.state === 'funding' && (
        <div className="duel-card">
          <b>Real $POG stakes</b>
          <p>
            Each side pays {describeStake(view.stake)} into the arena pool on chain. The match starts
            when both are final; if one side does not pay in time, whatever was paid goes back.
          </p>
          <p>
            You: {view.me.funded ? 'paid' : 'not yet'} · {view.them?.name}: {view.them?.funded ? 'paid' : 'not yet'}
          </p>
          {!view.me.funded && (
            <button className="btn btn-primary" disabled={paying} onClick={() => void payStake()}>
              {paying ? 'Waiting for the chain…' : 'Pay my stake'}
            </button>
          )}
        </div>
      )}

      {over && view && (
        <div className="duel-card">
          <b>
            {view.state === 'cancelled' ? 'Called off' : view.won ? 'You win!' : view.winner === null ? 'A draw' : 'Beaten'}
          </b>
          <p>{view.reason}</p>
          {view.state === 'done' && view.won && view.stake.kind === 'soft' && (
            <p>The pot is in your pack.</p>
          )}
          {view.payouts?.filter((p) => p.to === view.me.wallet).map((p, i) => (
            <p key={i}>
              {p.kind === 'win' ? 'Winnings' : 'Refund'}: {p.amount.toLocaleString('en-US')} $POG —{' '}
              {p.status === 'paid' ? 'sent on chain' : 'queued for payout'}
            </p>
          ))}
          <button className="btn btn-ghost" onClick={onLeave}>
            Back to the ice
          </button>
        </div>
      )}

      {!over && (
        <button
          className="duel-leave"
          onClick={() => {
            if (live && !confirm('Leaving a live match forfeits it after three missed volleys. Leave anyway?')) return;
            onLeave();
          }}
        >
          <Icon name="close" size={14} /> Leave
        </button>
      )}

      {error && <p className="duel-error">{error}</p>}
    </div>
  );
}
