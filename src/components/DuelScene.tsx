import { useCallback, useEffect, useRef, useState } from 'react';
import { FIGHT, simulate } from '../../shared/fight.js';
import { blitPenguin, drawPenguinWithTool } from '../game/penguin';
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

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

const nonce = () => Math.random().toString(36).slice(2, 10);
const THROW_ANIM_MS = 420;

/**
 * The fight, on screen.
 *
 * Every frame the world is rebuilt from the input log by the same
 * `simulate` the server scores with, so what you see is what will count —
 * once the server has stamped it. Your own inputs are drawn the moment
 * you make them (guessing the stamp), the opponent's the moment they
 * arrive over the broker, and both are replaced by the server's stamped
 * copies within a poll. The picture can nudge; the score never lies.
 *
 * Everything else here is theatre: arcs, trails, splats, shakes and snow.
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

  // theatre state
  const seenEvents = useRef(new Set<string>());
  const throwAnim = useRef<Record<'a' | 'b', number>>({ a: -Infinity, b: -Infinity });
  const wasAirborne = useRef<Record<'a' | 'b', boolean>>({ a: false, b: false });
  const particles = useRef<Particle[]>([]);
  const pops = useRef<Array<{ t: number; x: number; y: number; text: string; color: string }>>([]);
  const shakeUntil = useRef(0);
  const trails = useRef(new Map<string, Array<{ x: number; y: number }>>());
  const snow = useRef<Array<{ x: number; y: number; r: number; v: number; d: number }>>([]);
  const confetti = useRef<Particle[]>([]);
  const celebrated = useRef(false);

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
        const known = new Set(inputs.map((i) => i.n).filter(Boolean));
        provisional.current = provisional.current.filter((p) => !known.has(p.n));
      }
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
      if (!v || !v.them || m.from !== v.them.wallet) return;
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

  const merged = () => {
    const out: Array<FightInput | Provisional> = [...log.current];
    for (const p of provisional.current) out.push(p);
    return out;
  };

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
          entry.t = t;
          entry.seq = seq;
        })
        .catch((err: Error) => {
          provisional.current = provisional.current.filter((p) => p !== entry);
          // a key pressed a beat early or a beat late is not news
          if (!/Slow down|Not yet|not on|is over/.test(err.message)) setError(err.message);
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
        const v = viewRef.current;
        const world = simulate(merged(), v?.startAt ?? 0, serverNow());
        const them = v?.side === 'a' ? world.b : world.a;
        // lead a moving target a touch, which is where the skill is
        send({ type: 'throw', kind: 'lob', targetX: Math.round(Math.max(30, Math.min(FIGHT.width - 30, them.x + them.dir * 90))) });
      }
    },
    [send]
  );

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
    let last = performance.now();

    const burst = (x: number, y: number, n: number, speed: number, color = '#ffffff') => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        particles.current.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: 0, max: 0.5 + Math.random() * 0.4, r: 2 + Math.random() * 4, color });
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const pnow = performance.now();
      const dt = Math.min(0.05, (pnow - last) / 1000);
      last = pnow;
      const v = viewRef.current;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * devicePixelRatio || el.height !== h * devicePixelRatio) {
        el.width = w * devicePixelRatio;
        el.height = h * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      // a shake after a hit
      if (pnow < shakeUntil.current) {
        const k = (shakeUntil.current - pnow) / 260;
        ctx.translate((Math.random() - 0.5) * 12 * k, (Math.random() - 0.5) * 8 * k);
      }

      const ground = h * 0.74;
      const margin = 60;
      const sx = (x: number) => margin + (x / FIGHT.width) * (w - margin * 2);
      const scale = Math.min(1.25, Math.max(0.75, w / 1100));
      const pengH = 84 * scale;
      const unit = (w - margin * 2) / FIGHT.width;
      const yUnit = Math.min(unit * 1.6, 1.1);

      // sky, hills, pines
      const sky = ctx.createLinearGradient(0, 0, 0, ground);
      sky.addColorStop(0, '#cfe7f7');
      sky.addColorStop(1, '#eef7fc');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, ground);
      for (const [cx, rw, rh, col] of [
        [w * 0.18, w * 0.5, h * 0.22, '#dcecf6'],
        [w * 0.8, w * 0.55, h * 0.26, '#d6e8f4'],
        [w * 0.5, w * 0.4, h * 0.15, '#e4f0f8'],
      ] as Array<[number, number, number, string]>) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(cx, ground, rw, rh, 0, Math.PI, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 9; i++) {
        const px = (((i * 137) % 100) / 100) * w;
        const ph = (28 + ((i * 53) % 40)) * scale;
        ctx.fillStyle = i % 2 ? '#8fb7a1' : '#7ba892';
        ctx.beginPath();
        ctx.moveTo(px, ground - ph - 6);
        ctx.lineTo(px - ph * 0.42, ground - 2);
        ctx.lineTo(px + ph * 0.42, ground - 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(px, ground - ph - 6);
        ctx.lineTo(px - ph * 0.2, ground - ph * 0.55);
        ctx.lineTo(px + ph * 0.2, ground - ph * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      // the rink
      ctx.fillStyle = '#e9f3fa';
      ctx.fillRect(0, ground, w, h - ground);
      ctx.strokeStyle = 'rgba(120,170,205,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ground);
      ctx.lineTo(w, ground);
      ctx.stroke();
      ctx.setLineDash([8, 10]);
      ctx.strokeStyle = 'rgba(120,170,205,0.35)';
      ctx.beginPath();
      ctx.moveTo(w / 2, ground + 6);
      ctx.lineTo(w / 2, h - 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      for (const bx of [0, w]) {
        ctx.beginPath();
        ctx.ellipse(bx, ground + 10, 90, 40, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const px of [margin * 0.55, w - margin * 0.55]) {
        for (const [dx, dy, r] of [
          [-8, 0, 7],
          [8, 0, 7],
          [0, 2, 7.5],
          [0, -8, 6.5],
        ]) {
          ctx.beginPath();
          ctx.arc(px + dx, ground - 6 + dy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // snow, always
      if (snow.current.length < 70) {
        snow.current.push({ x: Math.random() * w, y: -10, r: 1 + Math.random() * 2.2, v: 18 + Math.random() * 30, d: (Math.random() - 0.5) * 20 });
      }
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const f of snow.current) {
        f.y += f.v * dt;
        f.x += f.d * dt + Math.sin(f.y / 40) * 0.3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      snow.current = snow.current.filter((f) => f.y < h + 10);

      if (v && v.state === 'live' && v.startAt) {
        const now = serverNow();
        const world = simulate(merged(), v.startAt, Math.max(v.startAt, now));

        // events that just happened become theatre
        for (const e of world.events) {
          const key = `${e.type}:${e.side}:${Math.round(e.t / 40)}`;
          if (seenEvents.current.has(key) || now - e.t > 900) continue;
          seenEvents.current.add(key);
          if (e.type === 'throw') throwAnim.current[e.side as 'a' | 'b'] = pnow;
          if (e.type === 'hit') {
            const hx = sx(e.x);
            const hy = ground - (e.y ?? 0) * yUnit - pengH * 0.5;
            burst(hx, hy, 26, 260 * scale);
            burst(hx, hy, 10, 120 * scale, '#bfe3f7');
            shakeUntil.current = pnow + 260;
            pops.current.push({ t: pnow, x: hx, y: hy - pengH * 0.4, text: 'HIT!', color: e.side === v.side ? '#ff5c17' : '#38bdf8' });
          }
        }

        const fighters: Array<[typeof world.a, 'a' | 'b', 'left' | 'right', string]> = [
          [world.a, 'a', 'right', v.side === 'a' ? (identity?.color ?? v.me.color) : (v.them?.color ?? '#38bdf8')],
          [world.b, 'b', 'left', v.side === 'b' ? (identity?.color ?? v.me.color) : (v.them?.color ?? '#38bdf8')],
        ];
        for (const [f, sideKey, dir, color] of fighters) {
          const x = sx(f.x);
          const y = ground - f.y * yUnit;
          // landing puff
          if (wasAirborne.current[sideKey] && !f.airborne) burst(x, ground - 4, 8, 90 * scale, '#f4faff');
          wasAirborne.current[sideKey] = f.airborne;

          ctx.fillStyle = 'rgba(56,92,120,0.25)';
          ctx.beginPath();
          ctx.ellipse(x, ground + 2, 24 * scale * (1 - Math.min(0.5, f.y / 400)), 8 * scale, 0, 0, Math.PI * 2);
          ctx.fill();

          const stunned = now < f.stunUntil;
          // squash and stretch: long on the way up, flat on the way down
          const stretch = f.airborne ? 1 + Math.max(-0.12, Math.min(0.14, f.vy / 4000)) : 1;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(1 / Math.sqrt(stretch), stretch);
          if (stunned) ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(now / 45));
          const since = pnow - throwAnim.current[sideKey];
          if (since < THROW_ANIM_MS) {
            drawPenguinWithTool(ctx, color, dir, 0, false, 0, 0, pengH, null, { kind: 'ball', phase: since / THROW_ANIM_MS, side: dir === 'right' ? 1 : -1 });
          } else {
            blitPenguin(ctx, color, dir, Math.floor(now / 90), f.dir !== 0 && !f.airborne, 0, 0, pengH);
          }
          ctx.restore();
          ctx.globalAlpha = 1;
          if (stunned) {
            ctx.fillStyle = '#ffd44d';
            for (let i = 0; i < 3; i++) {
              const a = now / 260 + (i * Math.PI * 2) / 3;
              const px = x + Math.cos(a) * 28 * scale;
              const py = y - pengH - 6 + Math.sin(a) * 7;
              ctx.beginPath();
              for (let k = 0; k < 5; k++) {
                const ang = (k * 4 * Math.PI) / 5 - Math.PI / 2;
                ctx.lineTo(px + Math.cos(ang) * 5 * scale, py + Math.sin(ang) * 5 * scale);
              }
              ctx.closePath();
              ctx.fill();
            }
          }
        }

        // balls: a trail behind, a shadow below, spin on the ball
        const liveKeys = new Set<string>();
        for (const ball of world.balls) {
          const key = `${ball.owner}:${ball.launchedAt}`;
          liveKeys.add(key);
          const x = sx(ball.x);
          const y = ground - ball.y * yUnit;
          const trail = trails.current.get(key) ?? [];
          trail.push({ x, y });
          if (trail.length > 9) trail.shift();
          trails.current.set(key, trail);
          trail.forEach((p, i) => {
            ctx.globalAlpha = (i / trail.length) * 0.35;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(p.x, p.y, (4 + (i / trail.length) * 5) * scale, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(56,92,120,0.18)';
          ctx.beginPath();
          ctx.ellipse(x, ground + 2, 10 * scale * (1 - Math.min(0.6, ball.y / 500)), 4 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(150,190,215,0.9)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, 10 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // a spinning highlight
          const spin = ball.x / 22;
          ctx.fillStyle = 'rgba(190,225,245,0.7)';
          ctx.beginPath();
          ctx.arc(x + Math.cos(spin) * 4 * scale, y + Math.sin(spin) * 4 * scale, 3.2 * scale, 0, Math.PI * 2);
          ctx.fill();
          if (ball.kind === 'lob' && ball.targetX !== undefined) {
            const p = Math.min(1, (now - ball.launchedAt) / FIGHT.lobMs);
            ctx.strokeStyle = `rgba(255,92,23,${0.25 + p * 0.5})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(sx(ball.targetX), ground + 2, FIGHT.lobRadius * unit, 6 * scale, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        for (const k of trails.current.keys()) if (!liveKeys.has(k)) trails.current.delete(k);

        // countdown
        if (now < v.startAt) {
          const left = (v.startAt - now) / 1000;
          const n = Math.ceil(left);
          const frac = left - Math.floor(left);
          ctx.fillStyle = '#0f2f38';
          ctx.font = `800 ${Math.round((60 + frac * 40) * scale)}px "Baloo 2", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = 0.5 + frac * 0.5;
          ctx.fillText(String(n), w / 2, h * 0.36);
          ctx.globalAlpha = 1;
        } else if (now - v.startAt < 900) {
          const k = (now - v.startAt) / 900;
          ctx.fillStyle = '#ff5c17';
          ctx.font = `800 ${Math.round((64 + k * 30) * scale)}px "Baloo 2", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.globalAlpha = 1 - k;
          ctx.fillText('FIGHT!', w / 2, h * 0.36);
          ctx.globalAlpha = 1;
        }
      }

      // particles: snow bursts and puffs
      for (const p of particles.current) {
        p.life += dt;
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      particles.current = particles.current.filter((p) => p.life < p.max);

      // pops
      pops.current = pops.current.filter((p) => pnow - p.t < 700);
      for (const p of pops.current) {
        const k = (pnow - p.t) / 700;
        const grow = k < 0.2 ? k / 0.2 : 1;
        ctx.globalAlpha = 1 - Math.max(0, k - 0.5) * 2;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.font = `800 ${Math.round(34 * scale * (0.6 + grow * 0.6))}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeText(p.text, p.x, p.y - k * 30 * scale);
        ctx.fillText(p.text, p.x, p.y - k * 30 * scale);
      }
      ctx.globalAlpha = 1;

      // confetti for a winner
      if (v?.state === 'done' && v.won && !celebrated.current) {
        celebrated.current = true;
        for (let i = 0; i < 120; i++) {
          confetti.current.push({
            x: Math.random() * w,
            y: -20 - Math.random() * h * 0.5,
            vx: (Math.random() - 0.5) * 60,
            vy: 60 + Math.random() * 120,
            life: 0,
            max: 6,
            r: 3 + Math.random() * 4,
            color: ['#ff5c17', '#38bdf8', '#ffd44d', '#4ade80', '#c084fc'][i % 5],
          });
        }
      }
      for (const p of confetti.current) {
        p.life += dt;
        p.x += p.vx * dt + Math.sin(p.life * 6 + p.r) * 0.8;
        p.y += p.vy * dt;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.r * 1.6, p.r);
      }
      confetti.current = confetti.current.filter((p) => p.y < h + 20);
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

  let myHits = view?.myHits ?? 0;
  let theirHits = view?.theirHits ?? 0;
  if (live && view?.startAt) {
    const world = simulate(merged(), view.startAt, Math.max(view.startAt, serverNow()));
    myHits = view.side === 'a' ? world.a.hits : world.b.hits;
    theirHits = view.side === 'a' ? world.b.hits : world.a.hits;
  }
  const leftHits = view?.side === 'a' ? myHits : theirHits;
  const rightHits = view?.side === 'b' ? myHits : theirHits;

  const hold = (key: 'left' | 'right', on: boolean) => {
    held.current[key] = on;
    move();
  };

  const marks = (n: number, color: string) => (
    <span className="duel-marks">
      {Array.from({ length: FIGHT.hitsToWin }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} style={i < n ? { background: color, color } : undefined} />
      ))}
    </span>
  );

  const leftName = view?.side === 'a' ? view?.me.name : (view?.them?.name ?? '…');
  const rightName = view?.side === 'b' ? view?.me.name : (view?.them?.name ?? '…');
  const leftColor = view?.side === 'a' ? (identity?.color ?? '#ff6b2c') : (view?.them?.color ?? '#38bdf8');
  const rightColor = view?.side === 'b' ? (identity?.color ?? '#ff6b2c') : (view?.them?.color ?? '#38bdf8');

  return (
    <div className="duel">
      <canvas ref={canvas} className="duel-rink" />

      <div className="duel-top">
        <div className="duel-side">
          <b style={{ color: leftColor }}>{leftName}</b>
          {marks(leftHits, leftColor)}
          <span>{leftHits}</span>
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
          {view && <small className="duel-pot">Pot: {describeStake(view.stake)} × 2</small>}
        </div>
        <div className="duel-side me">
          <span>{rightHits}</span>
          {marks(rightHits, rightColor)}
          <b style={{ color: rightColor }}>{rightName}</b>
        </div>
      </div>

      {live && (
        <div className="duel-controls">
          <div className="duel-group">
            <button className="duel-btn big" onPointerDown={() => hold('left', true)} onPointerUp={() => hold('left', false)} onPointerLeave={() => hold('left', false)}>
              ◀
            </button>
            <button className="duel-btn big" onPointerDown={() => hold('right', true)} onPointerUp={() => hold('right', false)} onPointerLeave={() => hold('right', false)}>
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
          <small className="duel-keys">A D move · W jump · J fast ball · K lob — jump the fast ones, step out from under the lobs</small>
        </div>
      )}

      {view?.state === 'funding' && (
        <div className="duel-card">
          <b>Real $POG stakes</b>
          <p>
            Each side pays {describeStake(view.stake)} into the arena pool on chain. The match starts when both are
            final; if one side does not pay in time, whatever was paid goes back.
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
