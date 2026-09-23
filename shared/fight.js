/**
 * The snowball fight itself: a side-on, real-time duel, simulated the same
 * way everywhere from one log of inputs.
 *
 * ------------------------------------------------------------------ *
 * How it stays honest in real time
 * ------------------------------------------------------------------ *
 *
 * A client never reports where it is or what it hit. It reports what the
 * player DID — move, jump, throw — and the server stamps each input with
 * the time it arrived. The match is then a pure function of that log:
 * `simulate(inputs, startAt, until)` steps a fixed-rate world forward and
 * applies each input at its server time. Both clients run the very same
 * function for the picture on screen; the server runs it for the result.
 *
 * So a dodge counts only if the jump reached the server before the ball
 * did. Nobody can backdate an input, nobody can claim a hit, and a client
 * that lies to itself only draws a fight the server will not score.
 *
 * Reading the opponent still matters: a straight ball is dodged by jumping
 * and a lob by stepping out from under it, a jump has a cooldown, and a
 * second ball thrown while the first is in the air is the whole art.
 */

export const FIGHT = {
  /** the stage, in world units, and where each side starts */
  width: 1000,
  startA: 180,
  startB: 820,
  /** the closest the two may stand */
  minGap: 140,
  /** fixed simulation rate */
  tickMs: 1000 / 60,
  /** movement */
  speed: 360,
  jumpV: 720,
  gravity: 2400,
  jumpCooldownMs: 950,
  /** how tall a standing penguin is, for the straight ball */
  bodyTop: 74,
  /**
   * Throws. The cooldown is deliberately LONGER than a jump's cooldown plus
   * its airtime: a stream of straight balls must always be dodgeable by a
   * player who reads them, or the first hit decides the match.
   */
  throwCooldownMs: 1400,
  maxBalls: 2,
  /**
   * The arm has to come round before the ball leaves. Without this a
   * penguin standing at the minimum gap could throw faster than anyone
   * can see, and rushing in would beat everything.
   */
  windupMs: 220,
  straightSpeed: 700,
  straightHeight: 34,
  /** the fast ball still arcs a little over the middle of its flight */
  straightArc: 40,
  lobMs: 1100,
  lobPeak: 300,
  lobRadius: 46,
  /** what a hit does: a moment frozen, and a shove backwards */
  stunMs: 600,
  knockback: 55,
  /** the match */
  hitsToWin: 5,
  durationMs: 60_000,
  overtimeMs: 15_000,
  countdownMs: 4000,
  /** the most inputs one side may send per second */
  inputsPerSec: 15,
};

export const INPUT_TYPES = ['move', 'jump', 'throw'];

/** Is this something a player can do? (Shape only; timing is the server's.) */
export function validInput(i) {
  if (!i || typeof i !== 'object') return false;
  if (i.type === 'move') return i.dir === -1 || i.dir === 0 || i.dir === 1;
  if (i.type === 'jump') return true;
  if (i.type === 'throw') {
    if (i.kind === 'straight') return true;
    if (i.kind === 'lob') return Number.isFinite(i.targetX) && i.targetX >= 0 && i.targetX <= FIGHT.width;
  }
  return false;
}

function fighter(x, facing) {
  return { x, y: 0, vy: 0, dir: 0, facing, hits: 0, stunUntil: 0, jumpReadyAt: 0, throwReadyAt: 0, airborne: false };
}

/**
 * Run the fight from `startAt` (server ms) to `until`, applying `inputs`
 * — each `{ t, side: 'a'|'b', type, ... }` with a server timestamp — as
 * the clock passes them. Returns the world at `until`, plus every event
 * along the way (hits, throws) so the picture can react to them.
 */
export function simulate(inputs, startAt, until) {
  const a = fighter(FIGHT.startA, 1);
  const b = fighter(FIGHT.startB, -1);
  const balls = [];
  const events = [];
  const sorted = [...inputs].filter((i) => i && Number.isFinite(i.t)).sort((p, q) => p.t - q.t || (p.seq ?? Infinity) - (q.seq ?? Infinity));
  let next = 0;
  const dt = FIGHT.tickMs / 1000;

  const side = (s) => (s === 'a' ? a : b);
  const other = (s) => (s === 'a' ? b : a);

  const apply = (i, t) => {
    const f = side(i.side);
    if (t < f.stunUntil) return; // stunned: nothing goes through
    if (i.type === 'move') {
      f.dir = i.dir;
    } else if (i.type === 'jump') {
      if (!f.airborne && t >= f.jumpReadyAt) {
        f.vy = FIGHT.jumpV;
        f.airborne = true;
        f.jumpReadyAt = t + FIGHT.jumpCooldownMs;
        events.push({ t, type: 'jump', side: i.side });
      }
    } else if (i.type === 'throw') {
      const mine = balls.filter((ball) => ball.owner === i.side && !ball.done).length;
      if (t < f.throwReadyAt || mine >= FIGHT.maxBalls) return;
      f.throwReadyAt = t + FIGHT.throwCooldownMs;
      const o = other(i.side);
      const release = t + FIGHT.windupMs;
      if (i.kind === 'straight') {
        balls.push({
          owner: i.side,
          kind: 'straight',
          x: f.x,
          y: FIGHT.straightHeight + f.y,
          fromX: f.x,
          span: Math.max(120, Math.abs(o.x - f.x)),
          vx: (o.x >= f.x ? 1 : -1) * FIGHT.straightSpeed,
          launchedAt: release,
          done: false,
        });
      } else {
        balls.push({
          owner: i.side,
          kind: 'lob',
          x: f.x,
          y: FIGHT.straightHeight + f.y,
          fromX: f.x,
          targetX: i.targetX,
          launchedAt: release,
          landsAt: release + FIGHT.lobMs,
          done: false,
        });
      }
      events.push({ t, type: 'throw', side: i.side, kind: i.kind });
    }
  };

  const end = Math.max(startAt, until);
  for (let t = startAt; t < end; t += FIGHT.tickMs) {
    const tNext = Math.min(end, t + FIGHT.tickMs);
    // inputs that arrived during this tick
    while (next < sorted.length && sorted[next].t < tNext) {
      if (sorted[next].t >= startAt) apply(sorted[next], sorted[next].t);
      next++;
    }

    // fighters
    for (const [f, o] of [
      [a, b],
      [b, a],
    ]) {
      if (t < f.stunUntil) {
        f.dir = 0;
      }
      let nx = f.x + f.dir * FIGHT.speed * dt;
      nx = Math.max(30, Math.min(FIGHT.width - 30, nx));
      // never through each other
      if (f === a && nx > o.x - FIGHT.minGap) nx = o.x - FIGHT.minGap;
      if (f === b && nx < o.x + FIGHT.minGap) nx = o.x + FIGHT.minGap;
      f.x = nx;
      if (f.airborne) {
        f.vy -= FIGHT.gravity * dt;
        f.y += f.vy * dt;
        if (f.y <= 0) {
          f.y = 0;
          f.vy = 0;
          f.airborne = false;
        }
      }
    }

    // balls
    for (const ball of balls) {
      if (ball.done) continue;
      if (tNext < ball.launchedAt) continue; // still in the hand
      const victim = ball.owner === 'a' ? b : a;
      if (ball.kind === 'straight') {
        if (!ball.flying) {
          ball.flying = true;
          ball.x = side(ball.owner).x;
          ball.fromX = ball.x;
        }
        const px = ball.x;
        ball.x += ball.vx * dt;
        // a shallow arc over the distance to where they stood when it left
        const p = Math.min(1, Math.abs(ball.x - ball.fromX) / ball.span);
        ball.y = FIGHT.straightHeight + Math.sin(p * Math.PI) * FIGHT.straightArc;
        // crossed the victim this tick?
        const crossed = (px - victim.x) * (ball.x - victim.x) <= 0;
        if (crossed) {
          ball.done = true;
          // the ball flies at chest height; a body in the air is clear of it
          if (victim.y < ball.y + 8 && tNext >= victim.stunUntil) hit(ball.owner, victim, tNext);
        } else if (ball.x < -40 || ball.x > FIGHT.width + 40) {
          ball.done = true;
        }
      } else {
        if (!ball.flying) {
          ball.flying = true;
          ball.fromX = side(ball.owner).x;
        }
        const p = Math.min(1, (tNext - ball.launchedAt) / FIGHT.lobMs);
        ball.x = ball.fromX + (ball.targetX - ball.fromX) * p;
        ball.y = FIGHT.straightHeight + Math.sin(p * Math.PI) * FIGHT.lobPeak;
        if (tNext >= ball.landsAt) {
          ball.done = true;
          // it comes down where it was aimed; be somewhere else
          if (Math.abs(victim.x - ball.targetX) <= FIGHT.lobRadius && tNext >= victim.stunUntil) hit(ball.owner, victim, tNext);
        }
      }
    }
  }

  function hit(owner, victim, t) {
    side(owner).hits += 1;
    victim.stunUntil = t + FIGHT.stunMs;
    victim.dir = 0;
    // shoved back a step, never past the wall or through the other penguin
    const away = victim === a ? -1 : 1;
    const o = victim === a ? b : a;
    let nx = victim.x + away * FIGHT.knockback;
    nx = Math.max(30, Math.min(FIGHT.width - 30, nx));
    if (victim === a && nx > o.x - FIGHT.minGap) nx = o.x - FIGHT.minGap;
    if (victim === b && nx < o.x + FIGHT.minGap) nx = o.x + FIGHT.minGap;
    victim.x = nx;
    events.push({ t, type: 'hit', side: owner, x: victim.x, y: victim.y });
  }

  return { a, b, balls: balls.filter((ball) => !ball.done && ball.flying), events, t: end };
}

/**
 * Is it over, and who won? `null` winner is a draw. Decided by hits first,
 * then by the clock — with overtime if the clock runs out level.
 */
export function outcome(state, startAt, now) {
  const { a, b } = state;
  if (a.hits >= FIGHT.hitsToWin || b.hits >= FIGHT.hitsToWin) {
    return { over: true, winner: a.hits > b.hits ? 'a' : 'b', reason: `First to ${FIGHT.hitsToWin}.` };
  }
  const elapsed = now - startAt;
  if (elapsed >= FIGHT.durationMs) {
    if (a.hits !== b.hits) return { over: true, winner: a.hits > b.hits ? 'a' : 'b', reason: 'Most hits when the clock ran out.' };
    if (elapsed >= FIGHT.durationMs + FIGHT.overtimeMs) return { over: true, winner: null, reason: 'Level after overtime — a draw.' };
  }
  return { over: false, winner: null, reason: '' };
}

/** When the match can no longer be running, whatever happens. */
export const hardEnd = (startAt) => startAt + FIGHT.durationMs + FIGHT.overtimeMs;
