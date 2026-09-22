import { useCallback, useEffect, useRef, useState } from 'react';
import { FIGHT, simulate } from '../../shared/fight.js';
import { blitPenguin } from '../game/penguin';
import { publishFightInput, subscribeFight } from '../game/presence';
import { api, type DuelView, type FightInput } from '../lib/api';
import { canSendTransactions, signAndSendTransaction } from '../lib/wallet';
import { useSession } from '../state/session';
import { describeStake } from './ArenaPanel';
import { Icon } from './Icon';

interface Props {
  id: string;
  onLeave: () => void;
}

type Wire = { type: 'move'; dir: number } | { type: 'jump' } | { type: 'throw'; kind: 'straight' } | { type: 'throw'; kind: 'lob'; targetX: number };

/** An input we know about but the server has not yet stamped. */
interface Provisional extends Omit<FightInput, 'seq'> {
  n: string;
  seq?: number;
  heardAt: number;
}

const nonce = () => Math.random().toString(36).slice(2, 10);

/**
 * The fight, on screen.
 *
 * Every frame the world is rebuilt from the input log by the same
 * `simulate` the server scores with, so what you see is what will count —
 * once the server has stamped it. Your own inputs are drawn the moment
 * you make them (guessing the stamp), the opponent's the moment they
 * arrive over the broker, and both are replaced by the server's stamped
 * copies within a poll. The picture can nudge; the score never lies.
 */
export function DuelScene({ id, onLeave }: Props) {
  const { connected, identity } = useSession();
  const [view, setView] = useState<DuelView | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<DuelView | null>(null);
  const log = useRef<FightInput[]>([]);
  const provisional = useRef<Provisional[]>([]);
  const lastSeq = useRef(0);
  const skew = useRef(0);
  const latency = useRef(120);
  const held = useRef({ left: false, right: false });
  const lastDir = useRef(0);
  const lastThrowAt = useRef(0);
  const lastJumpAt = useRef(0);
  const flashes = useRef<Array<{ t: number; x: number; side: 'a' | 'b' }>>([]);
  const seenHits = useRef(0);

  const serverNow = () => Date.now() + skew.current;

  /* ---------------- the truth, polled ---------------- */

  const refreshState = useCallback(async () => {
    try {
      const sent = Date.now();
      const { match } = await api.duel(id);
      const rtt = Date.now() - sent;
      if (!match) return;
      latency.current = Math.min(latency.current, rtt / 2) || rtt / 2;
      skew.current = match.serverNow - (sent + rtt / 2);
      viewRef.current = match;
      setView(match);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lost the arena.');
    }
  }, [id]);

  const pullInputs = useCallback(async () => {
    const v = viewRef.current;
    if (!v || v.state !== 'live') return;
    try {
      const { inputs } = await api.duelInputs(id, lastSeq.current);
      if (inputs.length) {
        log.current = log.current.concat(inputs);
        lastSeq.current = inputs[inputs.length - 1].seq;
        const known = new Set(inputs.map((i) => (i as FightInput & { n?: string }).n).filter(Boolean));
        provisional.current = provisional.current.filter((p) => !known.has(p.n));
      }
      // anything provisional the log should have carried by now is stale
      const cutoff = Date.now() - 2500;
      provisional.current = provisional.current.filter((p) => p.heardAt > cutoff);
    } catch {
      /* the next poll will catch up */
    }
  }, [id]);

  useEffect(() => {
    void refreshState();
    const a = setInterval(refreshState, 1000);
    const b = setInterval(pullInputs, 220);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refreshState, pullInputs]);

  /* ---------------- the fast lane ---------------- */

  useEffect(() => {
    return subscribeFight(id, (m) => {
      const v = viewRef.current;
      if (!v || !v.them || m.from !== v.them.wallet) return; // only the opponent
      const theirs: 'a' | 'b' = v.side === 'a' ? 'b' : 'a';
      provisional.current.push({
        n: m.n || 'mq' + m.ts + m.type,
        t: serverNow(),
        side: theirs,
        type: m.type,
        dir: m.dir,
        kind: m.kind,
        targetX: m.targetX,
        heardAt: Date.now(),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ---------------- what the player does ---------------- */

  const send = useCallback(
    (input: Wire) => {
      const v = viewRef.current;
      if (!v || v.state !== 'live' || !v.startAt || serverNow() < v.startAt) return;
      const n = nonce();
      const entry: Provisional = {
        n,
        t: serverNow() + latency.current,
        side: v.side,
        type: input.type,
        dir: input.type === 'move' ? input.dir : undefined,
        kind: input.type === 'throw' ? input.kind : undefined,
        targetX: input.type === 'throw' && input.kind === 'lob' ? input.targetX : undefined,
        heardAt: Date.now(),
      };
      provisional.current.push(entry);
      publishFightInput(id, { from: v.me.wallet, n, type: input.type, dir: entry.dir, kind: entry.kind, targetX: entry.targetX });
      api
        .duelInput(id, { ...input, n })
        .then(({ t, seq }) => {
          entry.t = t; // the stamp that counts
          entry.seq = seq;
        })
        .catch((err: Error) => {
          provisional.current = provisional.current.filter((p) => p !== entry);
          if (!/Slow down|Not yet/.test(err.message)) setError(err.message);
        });
    },
    [id]
  );

  const move = useCallback(() => {
    const dir = (held.current.right ? 1 : 0) - (held.current.left ? 1 : 0);
    if (dir === lastDir.current) return;
    lastDir.current = dir;
    send({ type: 'move', dir });
  }, [send]);

  const jump = useCallback(() => {
    if (Date.now() - lastJumpAt.current < 250) return;
    lastJumpAt.current = Date.now();
    send({ type: 'jump' });
  }, [send]);

  const throwBall = useCallback(
    (kind: 'straight' | 'lob') => {
      if (Date.now() - lastThrowAt.current < 300) return;
      lastThrowAt.current = Date.now();
      if (kind === 'straight') send({ type: 'throw', kind });
      else {
        // aim where they are now; leading them is the skill
        const v = viewRef.current;
        const world = simulate(merged(), v?.startAt ?? 0, serverNow());
        const them = v?.side === 'a' ? world.b : world.a;
        send({ type: 'throw', kind: 'lob', targetX: Math.round(them.x) });
      }
    },
    [send]
  );

  const merged = () => {
    const out: Array<FightInput | Provisional> = [...log.current];
    for (const p of provisional.current) out.push(p);
    return out;
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyA':
        case 'ArrowLeft':
          held.current.left = true;
          move();
          break;
        case 'KeyD':
        case 'ArrowRight':
          held.current.right = true;
          move();
          break;
        case 'KeyW':
        case 'ArrowUp':
        case 'Space':
          jump();
          break;
        case 'KeyJ':
        case 'KeyE':
          throwBall('straight');
          break;
        case 'KeyK':
        case 'KeyQ':
          throwBall('lob');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') held.current.left = false;
      else if (e.code === 'KeyD' || e.code === 'ArrowRight') held.current.right = false;
      else return;
      move();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [move, jump, throwBall]);

  /* ---------------- the picture ---------------- */

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

      // sky, far snow, the rink floor
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#dff1fb');
      sky.addColorStop(0.7, '#eef7fc');
      sky.addColorStop(0.71, '#f6fbff');
      sky.addColorStop(1, '#d9eaf5');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      const ground = h * 0.74;
      ctx.fillStyle = '#e7f2fa';
      ctx.fillRect(0, ground, w, h - ground);
      ctx.strokeStyle = 'rgba(120,170,205,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ground);
      ctx.lineTo(w, ground);
      ctx.stroke();
      // snow banks at the ends
      ctx.fillStyle = '#ffffff';
      for (const bx of [0, w]) {
        ctx.beginPath();
        ctx.ellipse(bx, ground + 6, 70, 34, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const margin = 60;
      const sx = (x: number) => margin + (x / FIGHT.width) * (w - margin * 2);
      const scale = Math.min(1.25, Math.max(0.75, w / 1100));
      const pengH = 84 * scale;
      const unit = ((w - margin * 2) / FIGHT.width) * 1.0; // world units -> px, horizontally
      const yUnit = Math.min(unit * 1.6, 1.1); // vertical exaggeration so a jump reads

      if (v && v.state === 'live' && v.startAt) {
        const now = serverNow();
        const world = simulate(merged(), v.startAt, Math.max(v.startAt, now));

        // new hits flash where they landed
        const hitEvents = world.events.filter((e) => e.type === 'hit');
        if (hitEvents.length > seenHits.current) {
          for (const e of hitEvents.slice(seenHits.current)) flashes.current.push({ t: performance.now(), x: e.x, side: e.side });
          seenHits.current = hitEvents.length;
        } else if (hitEvents.length < seenHits.current) {
          seenHits.current = hitEvents.length; // a provisional hit the server did not stamp
        }

        for (const [f, dir, color] of [
          [world.a, 'right', v.side === 'a' ? identity?.color ?? v.me.color : v.them?.color ?? '#38bdf8'],
          [world.b, 'left', v.side === 'b' ? identity?.color ?? v.me.color : v.them?.color ?? '#38bdf8'],
        ] as Array<[typeof world.a, 'left' | 'right', string]>) {
          const x = sx(f.x);
          const y = ground - f.y * yUnit;
          ctx.fillStyle = 'rgba(56,92,120,0.25)';
          ctx.beginPath();
          ctx.ellipse(x, ground + 2, 24 * scale * (1 - Math.min(0.5, f.y / 400)), 8 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          const stunned = now < f.stunUntil;
          if (stunned) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(now / 45));
          blitPenguin(ctx, color, dir, Math.floor(now / 90), f.dir !== 0 && !f.airborne, x, y, pengH);
          ctx.globalAlpha = 1;
          if (stunned) {
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < 3; i++) {
              const a = now / 300 + (i * Math.PI * 2) / 3;
              ctx.beginPath();
              ctx.arc(x + Math.cos(a) * 26 * scale, y - pengH - 8 + Math.sin(a) * 6, 3.5 * scale, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        for (const ball of world.balls) {
          const x = sx(ball.x);
          const y = ground - ball.y * yUnit;
          ctx.fillStyle = 'rgba(56,92,120,0.18)';
          ctx.beginPath();
          ctx.ellipse(x, ground + 2, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(150,190,215,0.9)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x, y, 9 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // where a lob would land, so the aim reads
        // (drawn for balls in the air, as a faint ring on the ground)
        for (const ball of world.balls) {
          if (ball.kind !== 'lob' || ball.targetX === undefined) continue;
          ctx.strokeStyle = 'rgba(255,92,23,0.45)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(sx(ball.targetX), ground + 2, FIGHT.lobRadius * unit, 6 * scale, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        // countdown
        if (now < v.startAt) {
          const n = Math.ceil((v.startAt - now) / 1000);
          ctx.fillStyle = '#0f2f38';
          ctx.font = `800 ${Math.round(72 * scale)}px "Baloo 2", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(n), w / 2, h * 0.38);
        } else if (now - v.startAt < 900) {
          ctx.fillStyle = '#ff5c17';
          ctx.font = `800 ${Math.round(64 * scale)}px "Baloo 2", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = 1 - (now - v.startAt) / 900;
          ctx.fillText('FIGHT!', w / 2, h * 0.38);
          ctx.globalAlpha = 1;
        }
      }

      // splats
      const pnow = performance.now();
      flashes.current = flashes.current.filter((f) => pnow - f.t < 500);
      for (const f of flashes.current) {
        const k = (pnow - f.t) / 500;
        const x = sx(f.x);
        const y = ground - 40 * yUnit;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * (12 + k * 34) * scale, y + Math.sin(a) * (8 + k * 24) * scale, (5 - k * 3) * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ff5c17';
        ctx.font = `800 ${Math.round(26 * scale)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HIT!', x, y - (36 + k * 24) * scale);
        ctx.globalAlpha = 1;
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payment did not go through.');
    }
    setPaying(false);
  };

  /* ---------------- the frame ---------------- */

  const live = view?.state === 'live';
  const over = view?.state === 'done' || view?.state === 'cancelled';
  const clockLeft = view?.startAt ? Math.max(0, view.startAt + FIGHT.durationMs - serverNow()) : 0;
  const overtime = view?.startAt ? serverNow() > view.startAt + FIGHT.durationMs : false;

  // the live score, from the same picture the rink draws
  let myHits = view?.myHits ?? 0;
  let theirHits = view?.theirHits ?? 0;
  if (live && view?.startAt) {
    const world = simulate(merged(), view.startAt, Math.max(view.startAt, serverNow()));
    myHits = view.side === 'a' ? world.a.hits : world.b.hits;
    theirHits = view.side === 'a' ? world.b.hits : world.a.hits;
  }

  const hold = (key: 'left' | 'right', on: boolean) => {
    held.current[key] = on;
    move();
  };

  return (
    <div className="duel">
      <canvas ref={canvas} className="duel-rink" />

      <div className="duel-top">
        <div className="duel-side">
          <b style={{ color: view?.side === 'a' ? identity?.color : view?.them?.color }}>
            {view?.side === 'a' ? view?.me.name : view?.them?.name ?? '…'}
          </b>
          <span>{view?.side === 'a' ? myHits : theirHits}</span>
        </div>
        <div className="duel-mid">
          {live && (
            <>
              <small>{overtime ? 'Overtime — next hit wins' : `${Math.ceil(clockLeft / 1000)}s`}</small>
              <div className="duel-clock">
                <i style={{ width: `${Math.min(100, (clockLeft / FIGHT.durationMs) * 100)}%` }} />
              </div>
              <small>First to {FIGHT.hitsToWin}</small>
            </>
          )}
          {view?.state === 'funding' && <small>Paying the stakes</small>}
          {over && <small>{view?.reason}</small>}
        </div>
        <div className="duel-side me">
          <b style={{ color: view?.side === 'b' ? identity?.color : view?.them?.color }}>
            {view?.side === 'b' ? view?.me.name : view?.them?.name ?? '…'}
          </b>
          <span>{view?.side === 'b' ? myHits : theirHits}</span>
        </div>
      </div>

      {view && <div className="duel-stake">Pot: {describeStake(view.stake)} × 2</div>}

      {live && (
        <div className="duel-controls">
          <div className="duel-group">
            <button
              className="duel-btn big"
              onPointerDown={() => hold('left', true)}
              onPointerUp={() => hold('left', false)}
              onPointerLeave={() => hold('left', false)}
            >
              ◀
            </button>
            <button
              className="duel-btn big"
              onPointerDown={() => hold('right', true)}
              onPointerUp={() => hold('right', false)}
              onPointerLeave={() => hold('right', false)}
            >
              ▶
            </button>
            <button className="duel-btn big" onPointerDown={jump}>
              Jump
            </button>
            <button className="duel-btn big throw" onPointerDown={() => throwBall('straight')}>
              Throw
            </button>
            <button className="duel-btn big throw" onPointerDown={() => throwBall('lob')}>
              Lob
            </button>
          </div>
          <small className="duel-keys">A D move · W jump · J straight · K lob — jump the straight ones, step out from under the lobs</small>
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
          <b>{view.state === 'cancelled' ? 'Called off' : view.won ? 'You win!' : view.winner === null ? 'A draw' : 'Beaten'}</b>
          <p>
            {view.reason} {view.state === 'done' ? `${view.myHits} – ${view.theirHits}.` : ''}
          </p>
          {view.state === 'done' && view.won && view.stake.kind === 'soft' && <p>The pot is in your pack.</p>}
          {view.payouts
            ?.filter((p) => p.to === view.me.wallet)
            .map((p, i) => (
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
            if (live && !confirm('Leaving a live match means standing still in it — the clock keeps running. Leave anyway?')) return;
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
