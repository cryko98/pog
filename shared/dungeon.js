/**
 * The bear caves: a run down a corridor with polar bears coming the other
 * way, P coins for every one you put down, and everything in your pack on
 * the line if you do not walk out again.
 *
 * ------------------------------------------------------------------ *
 * Honest the same way the arena is
 * ------------------------------------------------------------------ *
 *
 * The client sends what the player did — move, jump, throw, leave — and
 * the server stamps each input on arrival. The run is a pure function of
 * that log and a seed the server chose: `simulateRun` steps a fixed-rate
 * world and applies each input at its server time, and the bears' timing
 * comes from a seeded generator, so the client cannot know what is coming
 * any sooner than the server does and cannot claim a kill it did not make.
 *
 * The bet is the pack. Leaving with coins is only allowed when no bear is
 * close; dying loses the run's coins AND empties the pack — which is what
 * the igloo's store is for.
 */

export const CAVE = {
  width: 1000,
  startX: 120,
  spawnX: 1040,
  tickMs: 1000 / 60,
  /** the penguin */
  speed: 330,
  jumpV: 720,
  gravity: 2400,
  jumpCooldownMs: 1000,
  hp: 3,
  /** throws: straight balls, always toward the bears */
  throwCooldownMs: 700,
  windupMs: 200,
  ballSpeed: 760,
  ballHeight: 34,
  maxBalls: 2,
  /** bears */
  bearSpeed: 150,
  bearSpeedPerWave: 22,
  bearHp: 2,
  bearHpEvery: 1, // +1 hp every this many waves
  bearReach: 78,
  /** a bear swipes on its own clock, somewhere in this range, so it cannot be jumped by rote */
  bearSwipeMs: 700,
  bearSwipeJitterMs: 450,
  bearKnockback: 26,
  bearsAlive: 5,
  spawnMs: 2400,
  spawnMsPerWave: 320,
  spawnMsMin: 800,
  /** the loot, in P coins */
  coinsPerKill: 1,
  coinsEveryWaves: 2, // +1 coin every this many waves
  killsPerWave: 4,
  /** when leaving is allowed: no bear this close */
  leaveGap: 220,
  /** a run cannot outlast this; the cave "closes" and you are outside with the coins */
  durationMs: 180_000,
  cooldownMs: 30_000,
  inputsPerSec: 15,
};

export const RUN_INPUTS = ['move', 'jump', 'throw', 'leave'];

export function validRunInput(i) {
  if (!i || typeof i !== 'object') return false;
  if (i.type === 'move') return i.dir === -1 || i.dir === 0 || i.dir === 1;
  return i.type === 'jump' || i.type === 'throw' || i.type === 'leave';
}

/** A small, fast, deterministic generator — the same one the world uses. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from a run id, so the same id always makes the same cave. */
export function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const waveOf = (kills) => 1 + Math.floor(kills / CAVE.killsPerWave);
export const bearHpAt = (wave) => CAVE.bearHp + Math.floor((wave - 1) / CAVE.bearHpEvery);
export const coinsAt = (wave) => CAVE.coinsPerKill + Math.floor((wave - 1) / CAVE.coinsEveryWaves);
export const spawnMsAt = (wave) => Math.max(CAVE.spawnMsMin, CAVE.spawnMs - (wave - 1) * CAVE.spawnMsPerWave);
export const bearSpeedAt = (wave) => CAVE.bearSpeed + (wave - 1) * CAVE.bearSpeedPerWave;

/**
 * Run the cave from `startAt` to `until` under `inputs` (each `{ t, type,
 * dir? }` stamped by the server). Returns the world at `until`: the
 * penguin, the bears, the balls, the coins so far, and every event.
 */
export function simulateRun(inputs, seed, startAt, until) {
  const rnd = mulberry32(seed);
  const me = { x: CAVE.startX, y: 0, vy: 0, dir: 0, hp: CAVE.hp, airborne: false, jumpReadyAt: 0, throwReadyAt: 0, hurtAt: -Infinity };
  const bears = [];
  const balls = [];
  const events = [];
  let kills = 0;
  let coins = 0;
  let over = null; // { why: 'dead' | 'left' | 'closed', t }
  let nextSpawn = startAt + 1500;
  let nextBearId = 1;

  const sorted = [...inputs].filter((i) => i && Number.isFinite(i.t)).sort((p, q) => p.t - q.t || (p.seq ?? Infinity) - (q.seq ?? Infinity));
  let next = 0;
  const dt = CAVE.tickMs / 1000;

  const apply = (i, t) => {
    if (over) return;
    if (i.type === 'move') me.dir = i.dir;
    else if (i.type === 'jump') {
      if (!me.airborne && t >= me.jumpReadyAt) {
        me.vy = CAVE.jumpV;
        me.airborne = true;
        me.jumpReadyAt = t + CAVE.jumpCooldownMs;
        events.push({ t, type: 'jump' });
      }
    } else if (i.type === 'throw') {
      const mine = balls.filter((b) => !b.done).length;
      if (t < me.throwReadyAt || mine >= CAVE.maxBalls) return;
      me.throwReadyAt = t + CAVE.throwCooldownMs;
      balls.push({ x: me.x, y: CAVE.ballHeight, launchedAt: t + CAVE.windupMs, flying: false, done: false });
      events.push({ t, type: 'throw' });
    } else if (i.type === 'leave') {
      const near = bears.some((b) => !b.dead && Math.abs(b.x - me.x) < CAVE.leaveGap);
      if (near) {
        events.push({ t, type: 'nope' });
        return;
      }
      over = { why: 'left', t };
      events.push({ t, type: 'left' });
    }
  };

  const end = Math.max(startAt, until);
  for (let t = startAt; t < end && !over; t += CAVE.tickMs) {
    const tNext = Math.min(end, t + CAVE.tickMs);
    while (next < sorted.length && sorted[next].t < tNext) {
      if (sorted[next].t >= startAt) apply(sorted[next], sorted[next].t);
      next++;
    }
    if (over) break;

    // the cave closes: out you go with what you have
    if (tNext - startAt >= CAVE.durationMs) {
      over = { why: 'closed', t: tNext };
      events.push({ t: tNext, type: 'closed' });
      break;
    }

    const wave = waveOf(kills);

    // spawn
    if (tNext >= nextSpawn && bears.filter((b) => !b.dead).length < CAVE.bearsAlive) {
      bears.push({ id: nextBearId++, x: CAVE.spawnX, hp: bearHpAt(wave), maxHp: bearHpAt(wave), speed: bearSpeedAt(wave) * (0.9 + rnd() * 0.2), swipeEvery: CAVE.bearSwipeMs + rnd() * CAVE.bearSwipeJitterMs, swipeAt: 0, dead: false, bornAt: tNext });
      events.push({ t: tNext, type: 'spawn', id: nextBearId - 1 });
      nextSpawn = tNext + spawnMsAt(wave) * (0.8 + rnd() * 0.4);
    }

    // the penguin
    me.x = Math.max(40, Math.min(CAVE.width - 40, me.x + me.dir * CAVE.speed * dt));
    if (me.airborne) {
      me.vy -= CAVE.gravity * dt;
      me.y += me.vy * dt;
      if (me.y <= 0) {
        me.y = 0;
        me.vy = 0;
        me.airborne = false;
      }
    }

    // bears walk at you; close enough, they swipe — a body in the air is clear of a swipe
    for (const b of bears) {
      if (b.dead) continue;
      const gap = b.x - me.x;
      if (gap > CAVE.bearReach) b.x -= b.speed * dt;
      else {
        if (b.x < me.x + CAVE.bearReach * 0.6) b.x = me.x + CAVE.bearReach * 0.6;
        if (tNext >= b.swipeAt) {
          b.swipeAt = tNext + b.swipeEvery;
          events.push({ t: tNext, type: 'swipe', id: b.id });
          if (me.y < 40) {
            me.hp -= 1;
            me.hurtAt = tNext;
            events.push({ t: tNext, type: 'hurt', hp: me.hp });
            if (me.hp <= 0) {
              over = { why: 'dead', t: tNext };
              events.push({ t: tNext, type: 'dead' });
              break;
            }
          }
        }
      }
    }
    if (over) break;

    // balls fly right and stop at the first bear they meet
    for (const ball of balls) {
      if (ball.done || tNext < ball.launchedAt) continue;
      if (!ball.flying) {
        ball.flying = true;
        ball.x = me.x + 20;
      }
      ball.x += CAVE.ballSpeed * dt;
      const target = bears.find((b) => !b.dead && b.x - 30 <= ball.x && ball.x <= b.x + 30);
      if (target) {
        ball.done = true;
        target.hp -= 1;
        target.x += CAVE.bearKnockback;
        events.push({ t: tNext, type: 'hit', id: target.id, x: target.x });
        if (target.hp <= 0) {
          target.dead = true;
          kills += 1;
          const g = coinsAt(wave);
          coins += g;
          events.push({ t: tNext, type: 'kill', id: target.id, coins: g, x: target.x });
        }
      } else if (ball.x > CAVE.width + 60) {
        ball.done = true;
      }
    }
  }

  return {
    me,
    bears: bears.filter((b) => !b.dead),
    balls: balls.filter((b) => !b.done && b.flying),
    kills,
    wave: waveOf(kills),
    coins,
    over,
    events,
    t: end,
  };
}

/** When the run can no longer be running, whatever the log says. */
export const runHardEnd = (startAt) => startAt + CAVE.durationMs + 1000;
