/**
 * The bear caves: a run down a corridor with polar bears coming the other
 * way, P coins for every one you put down, and everything in your pack on
 * the line if you do not walk out again.
 *
 * ------------------------------------------------------------------ *
 * How it plays
 * ------------------------------------------------------------------ *
 *
 * You carry a handful of snowballs and pack more only while standing
 * still on the ground — so you cannot throw forever, and the moment you
 * stop to pack, the bears close in. A bear blocks the floor but not the
 * air: a well-timed jump carries you over it, after which it turns and
 * comes after you, with a beat's delay. A swipe is telegraphed — the paw
 * comes up, then lands — so a jump on the wind-up clears it. You throw
 * the way you face. Leaving means being back at the mouth with no bear
 * on your heels.
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
 */

export const CAVE = {
  width: 1000,
  startX: 120,
  /** the mouth: you have to be this far in or less to leave */
  mouthX: 190,
  spawnX: 1040,
  tickMs: 1000 / 60,
  /** the penguin */
  speed: 330,
  jumpV: 840,
  gravity: 2400,
  jumpCooldownMs: 700,
  hp: 3,
  /** how high the body has to be to clear a bear, or a swipe */
  clearHeight: 62,
  /** snowballs: a handful, packed one at a time while standing still — and only once the throwing has stopped for a beat */
  ammoMax: 8,
  ammoStart: 8,
  packDelayMs: 900,
  packMs: 450,
  /** throws: straight balls the way you face */
  throwCooldownMs: 520,
  windupMs: 160,
  ballSpeed: 760,
  ballHeight: 34,
  /** bears */
  bearSpeed: 125,
  bearSpeedPerWave: 14,
  bearHp: 2,
  bearHpEvery: 2, // +1 hp every this many waves
  bearReach: 80,
  /** a bear's body: the floor it blocks */
  bearBody: 64,
  /** a swipe comes up for this long before it lands — the window to jump */
  swipeWindupMs: 420,
  /** and comes again after this, plus a bear's own jitter */
  bearSwipeMs: 700,
  bearSwipeJitterMs: 500,
  /** how long a bear takes to turn round once you are behind it */
  bearTurnMs: 550,
  bearKnockback: 24,
  bearsAlive: 4,
  spawnMs: 3000,
  spawnMsPerWave: 280,
  spawnMsMin: 1000,
  /** the loot, in P coins */
  coinsPerKill: 1,
  coinsEveryWaves: 2, // +1 coin every this many waves
  killsPerWave: 4,
  /** when leaving is allowed: at the mouth, no bear this close */
  leaveGap: 200,
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
  const me = {
    x: CAVE.startX,
    y: 0,
    vy: 0,
    dir: 0,
    facing: 1,
    hp: CAVE.hp,
    ammo: CAVE.ammoStart,
    airborne: false,
    jumpReadyAt: 0,
    throwReadyAt: 0,
    hurtAt: -Infinity,
    /** when the next snowball is packed, while standing still */
    packAt: 0,
    lastThrowAt: -Infinity,
  };
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
  const inAir = () => me.y >= CAVE.clearHeight;

  const apply = (i, t) => {
    if (over) return;
    if (i.type === 'move') {
      me.dir = i.dir;
      if (i.dir) me.facing = i.dir;
    } else if (i.type === 'jump') {
      if (!me.airborne && t >= me.jumpReadyAt) {
        me.vy = CAVE.jumpV;
        me.airborne = true;
        me.jumpReadyAt = t + CAVE.jumpCooldownMs;
        events.push({ t, type: 'jump' });
      }
    } else if (i.type === 'throw') {
      if (t < me.throwReadyAt) return;
      if (me.ammo <= 0) {
        events.push({ t, type: 'empty' });
        return;
      }
      me.ammo -= 1;
      me.throwReadyAt = t + CAVE.throwCooldownMs;
      me.lastThrowAt = t;
      me.packAt = 0;
      balls.push({ x: me.x, y: CAVE.ballHeight, dir: me.facing, launchedAt: t + CAVE.windupMs, flying: false, done: false });
      events.push({ t, type: 'throw', dir: me.facing });
    } else if (i.type === 'leave') {
      const near = bears.some((b) => !b.dead && Math.abs(b.x - me.x) < CAVE.leaveGap);
      if (me.x > CAVE.mouthX) {
        events.push({ t, type: 'nope', why: 'far' });
        return;
      }
      if (near) {
        events.push({ t, type: 'nope', why: 'near' });
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

    // spawn, always from the deep end
    if (tNext >= nextSpawn && bears.filter((b) => !b.dead).length < CAVE.bearsAlive) {
      bears.push({
        id: nextBearId++,
        x: CAVE.spawnX,
        dir: -1,
        hp: bearHpAt(wave),
        maxHp: bearHpAt(wave),
        speed: bearSpeedAt(wave) * (0.9 + rnd() * 0.2),
        swipeEvery: CAVE.bearSwipeMs + rnd() * CAVE.bearSwipeJitterMs,
        swipeAt: 0,
        /** a swipe in the air: it lands at this time */
        landAt: 0,
        turnAt: 0,
        dead: false,
        bornAt: tNext,
      });
      events.push({ t: tNext, type: 'spawn', id: nextBearId - 1 });
      nextSpawn = tNext + spawnMsAt(wave) * (0.8 + rnd() * 0.4);
    }

    // the penguin: bears block the floor, not the air
    if (me.dir) {
      const nextX = Math.max(40, Math.min(CAVE.width - 40, me.x + me.dir * CAVE.speed * dt));
      let blocked = false;
      if (!inAir()) {
        for (const b of bears) {
          if (b.dead) continue;
          const gap = b.x - nextX;
          if (Math.abs(gap) < CAVE.bearBody && Math.sign(gap) === me.dir) {
            blocked = true;
            break;
          }
        }
      }
      if (!blocked) me.x = nextX;
    }
    if (me.airborne) {
      me.vy -= CAVE.gravity * dt;
      me.y += me.vy * dt;
      if (me.y <= 0) {
        me.y = 0;
        me.vy = 0;
        me.airborne = false;
        events.push({ t: tNext, type: 'land' });
      }
    }
    // packing snow: only still, only on the ground
    if (!me.airborne && me.dir === 0 && me.ammo < CAVE.ammoMax && tNext - me.lastThrowAt >= CAVE.packDelayMs) {
      if (!me.packAt) me.packAt = tNext + CAVE.packMs;
      else if (tNext >= me.packAt) {
        me.ammo += 1;
        me.packAt = me.ammo < CAVE.ammoMax ? tNext + CAVE.packMs : 0;
        events.push({ t: tNext, type: 'pack', ammo: me.ammo });
      }
    } else me.packAt = 0;

    // bears walk at you, turn round when you get past, and swipe on a wind-up
    for (const b of bears) {
      if (b.dead) continue;
      const toward = Math.sign(me.x - b.x) || b.dir;
      if (toward !== b.dir) {
        if (!b.turnAt) b.turnAt = tNext + CAVE.bearTurnMs;
        else if (tNext >= b.turnAt) {
          b.dir = toward;
          b.turnAt = 0;
          events.push({ t: tNext, type: 'turn', id: b.id, dir: b.dir });
        }
      } else b.turnAt = 0;

      const gap = Math.abs(b.x - me.x);
      const facingMe = b.dir === toward;
      if (gap > CAVE.bearReach || !facingMe) {
        // walk, but not through the penguin's body on the ground
        const step = b.speed * dt;
        const nx = b.x + b.dir * step;
        const wouldPass = !inAir() && Math.sign(me.x - b.x) !== Math.sign(me.x - nx) && Math.abs(me.x - nx) < CAVE.bearBody;
        if (!wouldPass) b.x = nx;
        continue;
      }
      // in reach and facing: swipe on a clock, with a wind-up that can be jumped
      if (b.landAt) {
        if (tNext >= b.landAt) {
          b.landAt = 0;
          const stillThere = Math.abs(b.x - me.x) <= CAVE.bearReach;
          if (stillThere && me.y < CAVE.clearHeight) {
            me.hp -= 1;
            me.hurtAt = tNext;
            events.push({ t: tNext, type: 'hurt', id: b.id, hp: me.hp });
            if (me.hp <= 0) {
              over = { why: 'dead', t: tNext };
              events.push({ t: tNext, type: 'dead' });
              break;
            }
          } else events.push({ t: tNext, type: 'miss', id: b.id });
        }
      } else if (tNext >= b.swipeAt) {
        b.landAt = tNext + CAVE.swipeWindupMs;
        b.swipeAt = b.landAt + b.swipeEvery;
        events.push({ t: tNext, type: 'swipe', id: b.id, dir: b.dir });
      }
    }
    if (over) break;

    // balls fly the way they were thrown and stop at the first bear they meet
    for (const ball of balls) {
      if (ball.done || tNext < ball.launchedAt) continue;
      if (!ball.flying) {
        ball.flying = true;
        ball.x = me.x + 20 * ball.dir;
      }
      ball.x += CAVE.ballSpeed * ball.dir * dt;
      const target = bears.find((b) => !b.dead && b.x - 30 <= ball.x && ball.x <= b.x + 30);
      if (target) {
        ball.done = true;
        target.hp -= 1;
        target.x += CAVE.bearKnockback * ball.dir;
        events.push({ t: tNext, type: 'hit', id: target.id, x: target.x });
        if (target.hp <= 0) {
          target.dead = true;
          kills += 1;
          const g = coinsAt(wave);
          coins += g;
          events.push({ t: tNext, type: 'kill', id: target.id, coins: g, x: target.x });
        }
      } else if (ball.x > CAVE.width + 60 || ball.x < -60) {
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
