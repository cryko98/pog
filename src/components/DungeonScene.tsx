import { useCallback, useEffect, useRef, useState } from 'react';
import { CAVE, simulateRun } from '../../shared/dungeon.js';
import { drawBear } from '../game/bear';
import { blitPenguin, drawPenguinWithTool } from '../game/penguin';
import { sound } from '../game/audio';
import { api, type RunInput, type RunView } from '../lib/api';
import { useSession } from '../state/session';
import { Icon } from './Icon';

interface Props {
  id: string;
  /** back onto the snow; `settled` says how it ended, if it did */
  onLeave: () => void;
}

type Wire = { type: 'move'; dir: number } | { type: 'jump' } | { type: 'throw' } | { type: 'leave' };

/** An input we made but the server has not yet stamped. */
interface Provisional extends Omit<RunInput, 'seq'> {
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

interface Bear {
  id: number;
  x: number;
  dir: number;
  hp: number;
  maxHp: number;
  speed: number;
  swipeAt: number;
  landAt: number;
  turnAt: number;
  bornAt: number;
}

const nonce = () => Math.random().toString(36).slice(2, 10);
const THROW_ANIM_MS = 380;
const big = (n: number) => n.toLocaleString('en-US');

/**
 * The caves, on screen.
 *
 * Same idea as the arena: every frame the corridor is rebuilt from the
 * input log by the `simulateRun` the server settles with, so what you see
 * is what will count. Your own inputs are drawn the moment you make them
 * and replaced by the server's stamped copies within a poll.
 */
export function DungeonScene({ id, onLeave }: Props) {
  const { identity } = useSession();
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<RunView | null>(null);
  const log = useRef<RunInput[]>([]);
  const provisional = useRef<Provisional[]>([]);
  const lastSeq = useRef(0);
  const skew = useRef(0);
  const latency = useRef(120);
  const held = useRef({ left: false, right: false });
  const lastDir = useRef(0);
  const lastThrowAt = useRef(0);
  const lastJumpAt = useRef(0);
  const [, tick] = useState(0);

  // theatre
  const seenEvents = useRef(new Set<string>());
  const throwAnim = useRef(-Infinity);
  const wasAirborne = useRef(false);
  const particles = useRef<Particle[]>([]);
  const pops = useRef<Array<{ t: number; x: number; y: number; text: string; color: string }>>([]);
  const shakeUntil = useRef(0);
  const flashUntil = useRef(0);
  const swipes = useRef(new Map<number, number>());
  const drips = useRef<Array<{ x: number; y: number; v: number }>>([]);
  const ended = useRef(false);

  const serverNow = () => Date.now() + skew.current;

  /* ---------------- the truth, polled ---------------- */

  const refreshState = useCallback(async () => {
    try {
      const sent = Date.now();
      const { run } = await api.cave(id);
      const rtt = Date.now() - sent;
      if (!run) return;
      latency.current = Math.min(latency.current, rtt / 2) || rtt / 2;
      skew.current = run.serverNow - (sent + rtt / 2);
      viewRef.current = run;
      setView(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lost the cave.');
    }
  }, [id]);

  const pullInputs = useCallback(async () => {
    const v = viewRef.current;
    if (!v || v.settled) return;
    try {
      const { inputs } = await api.caveInputs(id, lastSeq.current);
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
    sound.setTense(true);
    return () => sound.setTense(false);
  }, []);

  useEffect(() => {
    void refreshState();
    const a = setInterval(refreshState, 1000);
    const b = setInterval(pullInputs, 250);
    const c = setInterval(() => tick((n) => n + 1), 500);
    return () => {
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [refreshState, pullInputs]);

  /* ---------------- what the player does ---------------- */

  const merged = () => {
    const out: Array<RunInput | Provisional> = [...log.current];
    for (const p of provisional.current) out.push(p);
    return out;
  };

  const worldNow = () => {
    const v = viewRef.current;
    if (!v) return null;
    const now = serverNow();
    return simulateRun(merged(), v.seed, v.startAt, Math.max(v.startAt, Math.min(now, v.startAt + CAVE.durationMs + 1000)));
  };

  const send = useCallback(
    (input: Wire) => {
      const v = viewRef.current;
      if (!v || v.settled || serverNow() < v.startAt) return;
      const n = nonce();
      const entry: Provisional = {
        n,
        t: serverNow() + latency.current,
        type: input.type,
        dir: input.type === 'move' ? input.dir : undefined,
        heardAt: Date.now(),
      };
      provisional.current.push(entry);
      api
        .caveInput(id, { ...input, n })
        .then(({ t, seq }) => {
          entry.t = t;
          entry.seq = seq;
          if (input.type === 'leave') void refreshState();
        })
        .catch((err: Error) => {
          provisional.current = provisional.current.filter((p) => p !== entry);
          if (!/Slow down|Not yet|is over/.test(err.message)) setError(err.message);
          if (/is over/.test(err.message)) void refreshState();
        });
    },
    [id, refreshState]
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

  const throwBall = useCallback(() => {
    if (Date.now() - lastThrowAt.current < 250) return;
    lastThrowAt.current = Date.now();
    send({ type: 'throw' });
  }, [send]);

  const leave = useCallback(() => {
    const w = worldNow();
    if (w && w.me.x > CAVE.mouthX) {
      pops.current.push({ t: performance.now(), x: 0, y: 0, text: 'Get back to the mouth first!', color: '#ffd44d' });
      sound.error();
      return;
    }
    if (w && w.bears.some((b: Bear) => Math.abs(b.x - w.me.x) < CAVE.leaveGap)) {
      pops.current.push({ t: performance.now(), x: 0, y: 0, text: 'A bear is too close to leave!', color: '#ffd44d' });
      sound.error();
      return;
    }
    send({ type: 'leave' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [send]);

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
          throwBall();
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

      const scale = Math.min(w / (CAVE.width + 80), h / 420);
      const ground = h * 0.78;
      const originX = (w - CAVE.width * scale) / 2;
      const sx = (x: number) => originX + x * scale;
      const yUnit = scale;
      const pengH = 84 * scale;
      const bearH = 96 * scale;

      let shakeX = 0;
      let shakeY = 0;
      if (pnow < shakeUntil.current) {
        const k = (shakeUntil.current - pnow) / 260;
        shakeX = (Math.random() - 0.5) * 12 * k;
        shakeY = (Math.random() - 0.5) * 8 * k;
      }
      ctx.save();
      ctx.translate(shakeX, shakeY);

      // the cave: dark rock, a lit corridor of ice, stalactites
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#05080d');
      bg.addColorStop(0.55, '#101a26');
      bg.addColorStop(1, '#1a2a3a');
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, w + 40, h + 40);
      // ice floor
      const fl = ctx.createLinearGradient(0, ground, 0, h);
      fl.addColorStop(0, '#9fd3ee');
      fl.addColorStop(0.2, '#6fb3d6');
      fl.addColorStop(1, '#2d5f7d');
      ctx.fillStyle = fl;
      ctx.fillRect(-20, ground, w + 40, h - ground + 20);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-20, ground);
      ctx.lineTo(w + 20, ground);
      ctx.stroke();
      // cracks in the ice
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const cx = ((i * 137) % (w + 60)) - 30;
        ctx.beginPath();
        ctx.moveTo(cx, ground + 6 + (i % 3) * 9);
        ctx.lineTo(cx + 30 + (i % 4) * 12, ground + 18 + (i % 2) * 14);
        ctx.stroke();
      }
      // stalactites along the roof
      ctx.fillStyle = '#26384a';
      for (let i = 0; i < 14; i++) {
        const cx = (i / 13) * w + Math.sin(i * 3.1) * 12;
        const len = 30 + ((i * 53) % 60);
        const wd = 14 + ((i * 29) % 14);
        ctx.beginPath();
        ctx.moveTo(cx - wd, -2);
        ctx.lineTo(cx + wd, -2);
        ctx.lineTo(cx, len);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(160,210,240,0.35)';
      for (let i = 0; i < 14; i++) {
        const cx = (i / 13) * w + Math.sin(i * 3.1) * 12;
        const len = 30 + ((i * 53) % 60);
        ctx.beginPath();
        ctx.moveTo(cx - 3, len - 14);
        ctx.lineTo(cx + 3, len - 14);
        ctx.lineTo(cx, len);
        ctx.closePath();
        ctx.fill();
      }
      // drips
      if (drips.current.length < 6 && Math.random() < 0.03) {
        const i = Math.floor(Math.random() * 14);
        drips.current.push({ x: (i / 13) * w + Math.sin(i * 3.1) * 12, y: 30 + ((i * 53) % 60), v: 60 });
      }
      ctx.fillStyle = 'rgba(190,230,250,0.8)';
      for (const d of drips.current) {
        d.v += 700 * dt;
        d.y += d.v * dt;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, 1.6, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drips.current = drips.current.filter((d) => d.y < ground);
      // the way out, glowing on the left; the dark on the right
      const out = ctx.createRadialGradient(sx(-40), ground - 60 * scale, 10, sx(-40), ground - 60 * scale, 260 * scale);
      out.addColorStop(0, 'rgba(255,240,200,0.5)');
      out.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = out;
      ctx.fillRect(0, 0, w, h);
      const dark = ctx.createLinearGradient(sx(CAVE.width - 200), 0, w, 0);
      dark.addColorStop(0, 'rgba(0,0,0,0)');
      dark.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = dark;
      ctx.fillRect(sx(CAVE.width - 200), 0, w, h);
      // a torch on the wall
      const fl2 = 0.8 + Math.sin(pnow / 90) * 0.15;
      ctx.fillStyle = '#4e321c';
      ctx.fillRect(sx(60) - 3, ground - 200 * scale, 6, 46 * scale);
      ctx.fillStyle = `rgba(255,170,60,${fl2})`;
      ctx.beginPath();
      ctx.ellipse(sx(60), ground - 210 * scale, 8 * scale, 14 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      const torch = ctx.createRadialGradient(sx(60), ground - 210 * scale, 4, sx(60), ground - 210 * scale, 220 * scale);
      torch.addColorStop(0, `rgba(255,190,90,${0.28 * fl2})`);
      torch.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = torch;
      ctx.fillRect(0, 0, w, h);

      if (v && !v.settled && serverNow() >= v.startAt) {
        const now = serverNow();
        const world = simulateRun(merged(), v.seed, v.startAt, Math.max(v.startAt, Math.min(now, v.startAt + CAVE.durationMs + 1000)));

        for (const e of world.events) {
          const key = `${e.type}:${e.id ?? ''}:${Math.round(e.t / 40)}`;
          if (seenEvents.current.has(key) || now - e.t > 900) continue;
          seenEvents.current.add(key);
          if (e.type === 'throw') {
            throwAnim.current = pnow;
            sound.throwBall(false);
          }
          if (e.type === 'jump') sound.jump();
          if (e.type === 'spawn') sound.growl();
          if (e.type === 'jump') wasAirborne.current = true;
          if (e.type === 'swipe') {
            swipes.current.set(e.id as number, pnow);
            sound.growl();
          }
          if (e.type === 'empty') {
            pops.current.push({ t: pnow, x: sx(world.me.x), y: ground - pengH - 10, text: 'No snow — stand still to pack', color: '#bfe3f7' });
            sound.error();
          }
          if (e.type === 'pack') sound.click();
          if (e.type === 'miss') {
            pops.current.push({ t: pnow, x: sx(world.me.x), y: ground - pengH - 30, text: 'Dodged!', color: '#7cd67c' });
          }
          if (e.type === 'hit') {
            sound.splat();
            burst(sx(e.x as number), ground - bearH * 0.5, 18, 220 * scale);
          }
          if (e.type === 'kill') {
            sound.bearDown();
            sound.coin();
            const kx = sx(e.x as number);
            burst(kx, ground - bearH * 0.5, 22, 260 * scale, '#ffd44d');
            pops.current.push({ t: pnow, x: kx, y: ground - bearH, text: `+${e.coins} P`, color: '#ffd44d' });
          }
          if (e.type === 'hurt') {
            sound.hurt();
            shakeUntil.current = pnow + 260;
            flashUntil.current = pnow + 180;
            burst(sx(world.me.x), ground - pengH * 0.5, 14, 200 * scale, '#ff6b6b');
          }
          if (e.type === 'nope') {
            pops.current.push({ t: pnow, x: sx(world.me.x), y: ground - pengH - 10, text: (e as { why?: string }).why === 'far' ? 'Get back to the mouth!' : 'Too close to leave!', color: '#ffd44d' });
          }
          if (e.type === 'dead') sound.lose();
          if (e.type === 'left' || e.type === 'closed') sound.win();
        }
        if (world.over && !ended.current) {
          ended.current = true;
          setTimeout(() => void refreshState(), 300);
        }

        // the penguin's shadow
        const me = world.me;
        const px = sx(me.x);
        const py = ground - me.y * yUnit;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.ellipse(px, ground - 2, pengH * 0.3 * (1 - Math.min(0.5, me.y / 400)), pengH * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();

        // bears, back to front
        for (const b of world.bears as Bear[]) {
          const bx = sx(b.x);
          const born = Math.min(1, (now - b.bornAt) / 400);
          const swipeAge = pnow - (swipes.current.get(b.id) ?? -Infinity);
          const swipeLen = CAVE.swipeWindupMs + 160;
          const swiping = swipeAge < swipeLen;
          const toward = Math.sign(me.x - b.x) || b.dir;
          const walking = Math.abs(b.x - me.x) > CAVE.bearReach || b.dir !== toward;
          drawBear(ctx, bx, ground, bearH * (0.7 + 0.3 * born), now, walking, swiping ? swipeAge / swipeLen : -1, b.hp / b.maxHp, b.dir > 0 ? 1 : -1);
          // the wind-up: a warning over the bear that is about to swing
          if (swiping && swipeAge < CAVE.swipeWindupMs) {
            ctx.fillStyle = '#ffd44d';
            ctx.font = `800 ${Math.max(12, 18 * scale)}px "Baloo 2", system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('!', bx, ground - bearH - 8 - Math.sin(pnow / 60) * 3);
          }
        }

        // the penguin
        const hurtFlash = pnow < flashUntil.current;
        const stretch = me.airborne ? 1 + Math.max(-0.12, Math.min(0.14, me.vy / 4000)) : 1;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(1 / Math.sqrt(stretch), stretch);
        if (hurtFlash) ctx.globalAlpha = 0.5;
        const color = identity?.color ?? '#ff6b2c';
        const since = pnow - throwAnim.current;
        if (since < THROW_ANIM_MS) {
          drawPenguinWithTool(ctx, color, me.facing < 0 ? 'left' : 'right', 0, false, 0, 0, pengH, null, { kind: 'ball', phase: since / THROW_ANIM_MS, side: me.facing < 0 ? -1 : 1 });
        } else {
          blitPenguin(ctx, color, me.facing < 0 ? 'left' : 'right', Math.floor(now / 90), me.dir !== 0 && !me.airborne, 0, 0, pengH);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
        if (me.airborne !== wasAirborne.current) {
          if (!me.airborne) sound.land();
          wasAirborne.current = me.airborne;
        }

        // packing snow: the pile at the feet
        if (!me.airborne && me.dir === 0 && me.ammo < CAVE.ammoMax && now - me.lastThrowAt >= CAVE.packDelayMs) {
          const k = me.packAt ? 1 - Math.max(0, Math.min(1, (me.packAt - now) / CAVE.packMs)) : 0;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(px + pengH * 0.42 * me.facing, ground - 4 * scale, (3 + 5 * k) * scale, 0, Math.PI * 2);
          ctx.fill();
        }

        // balls
        for (const ball of world.balls) {
          const bx = sx(ball.x);
          const by = ground - ball.y * yUnit;
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.ellipse(bx, ground - 2, 7 * scale, 3 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(bx, by, 7 * scale, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(150,190,215,0.8)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          for (let k = 1; k <= 3; k++) {
            ctx.beginPath();
            ctx.arc(bx - k * 9 * scale * (ball.dir || 1), by, (7 - k * 1.6) * scale, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (v && !v.settled) {
        // the count-in
        const left = Math.ceil((v.startAt - serverNow()) / 1000);
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${Math.max(28, h * 0.12)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(left > 0 ? String(left) : 'GO', w / 2, h * 0.4);
      }

      // particles
      for (const p of particles.current) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 700 * dt;
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      particles.current = particles.current.filter((p) => p.life < p.max);

      // pops
      for (const p of pops.current) {
        const age = (pnow - p.t) / 1000;
        ctx.globalAlpha = Math.max(0, 1 - age / 1.1);
        ctx.fillStyle = p.color;
        ctx.font = `800 ${Math.max(14, 20 * scale)}px "Baloo 2", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const x = p.x || w / 2;
        const y = (p.y || h * 0.35) - age * 40;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 4;
        ctx.strokeText(p.text, x, y);
        ctx.fillText(p.text, x, y);
      }
      ctx.globalAlpha = 1;
      pops.current = pops.current.filter((p) => pnow - p.t < 1100);

      if (pnow < flashUntil.current) {
        ctx.fillStyle = 'rgba(255,60,60,0.25)';
        ctx.fillRect(-20, -20, w + 40, h + 40);
      }
      ctx.restore();
    };
    draw();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.color]);

  /* ---------------- the frame ---------------- */

  const world = view && !view.settled && serverNow() >= view.startAt ? worldNow() : null;
  const hp = view?.settled ? (view.settled.why === 'dead' ? 0 : CAVE.hp) : (world?.me.hp ?? CAVE.hp);
  const coins = view?.settled ? view.settled.coins : (world?.coins ?? 0);
  const kills = view?.settled ? view.settled.kills : (world?.kills ?? 0);
  const ammo = world?.me.ammo ?? CAVE.ammoStart;
  const packing = !!world && !world.me.airborne && world.me.dir === 0 && ammo < CAVE.ammoMax && serverNow() - world.me.lastThrowAt >= CAVE.packDelayMs;
  const wave = view?.settled ? view.settled.wave : (world?.wave ?? 1);
  const clockLeft = view ? Math.max(0, view.startAt + CAVE.durationMs - serverNow()) : 0;
  const live = !!view && !view.settled && serverNow() >= view.startAt;
  const done = view?.settled ?? null;

  const hold = (key: 'left' | 'right', on: boolean) => {
    held.current[key] = on;
    move();
  };

  const lostLine = done?.lost
    ? Object.entries(done.lost)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${big(n)} ${k === 'pog' ? 'P coins' : k}`)
        .join(', ')
    : '';

  return (
    <div className="duel cave-scene">
      <canvas ref={canvas} className="duel-rink" />

      <div className="duel-top">
        <div className="duel-side">
          <b>Hearts</b>
          <span className="cave-hearts">
            {Array.from({ length: CAVE.hp }, (_, i) => (
              <i key={i} className={i < hp ? 'on' : ''} />
            ))}
          </span>
          <span className={`cave-ammo${packing ? ' packing' : ''}`} title="Snowballs — stand still to pack more">
            {Array.from({ length: CAVE.ammoMax }, (_, i) => (
              <i key={i} className={i < ammo ? 'on' : ''} />
            ))}
            {packing && <small>packing…</small>}
          </span>
        </div>
        <div className="duel-mid">
          {live && (
            <>
              <small>{`${Math.ceil(clockLeft / 1000)}s until the cave closes`}</small>
              <div className="duel-clock">
                <i style={{ width: `${Math.min(100, (clockLeft / CAVE.durationMs) * 100)}%` }} />
              </div>
              <small>Wave {wave} · {kills} bears down</small>
            </>
          )}
          {!live && !done && <small>Get ready…</small>}
          {done && <small>{done.why === 'dead' ? 'The bears got you' : done.why === 'left' ? 'You walked out' : 'The cave closed'}</small>}
        </div>
        <div className="duel-side me">
          <span className="cave-gold">
            <Icon name="coin" size={16} /> {big(coins)}
          </span>
          <b>P coins</b>
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
            <button className="duel-btn big throw" onPointerDown={throwBall}>
              Throw
            </button>
            <button className="duel-btn big leave" onPointerDown={leave}>
              Leave
            </button>
          </div>
          <small className="duel-keys">A D move · W jump a swipe (the ! is your cue) or a bear · J throw the way you face · stand still to pack snow · leave from the mouth, with no bear close</small>
        </div>
      )}

      {done && (
        <div className="duel-card">
          <b>{done.why === 'dead' ? 'Eaten.' : `${big(done.coins)} P coins, yours.`}</b>
          <p>
            {done.why === 'dead'
              ? `Wave ${done.wave}, ${done.kills} bears down — and the pack is gone${lostLine ? `: ${lostLine}` : ''}.`
              : `Wave ${done.wave}, ${done.kills} bears down. The coins are in your pack.`}
          </p>
          <button className="btn btn-primary" onClick={onLeave}>
            Back to the snow
          </button>
        </div>
      )}

      {error && <div className="duel-error">{error}</div>}
      {!done && (
        <button className="duel-leave" onClick={onLeave}>
          <Icon name="close" size={14} /> Back to the snow (the run keeps going)
        </button>
      )}
    </div>
  );
}
