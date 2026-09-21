// Deterministic world generation shared by the client renderer and the server.
// Same seed in => same frozen world for every player, and no assets to download.

export const WORLD = {
  seed: 20260921,
  width: 6400,
  height: 6400,
  spawn: { x: 3200, y: 3200 },
  spawnRadius: 360,
};

export const PLAYER = {
  radius: 20,
  speed: 210, // world units / second
  sprintSpeed: 330,
  maxSpeed: 430, // server-side anti-cheat ceiling
};

export const COIN = {
  radius: 18,
  pickupRadius: 52,
  respawnMs: 45000,
  count: 260,
  value: 1,
};

/* ------------------------------------------------------------------ *
 * Tiny deterministic PRNG + value noise
 * ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export function noise2(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

export function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 977) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ *
 * Frozen lakes
 * ------------------------------------------------------------------ */

let _lakes = null;

export function getLakes() {
  if (_lakes) return _lakes;
  const rnd = mulberry32(WORLD.seed ^ 0x1ce1a);
  const lakes = [];
  for (let i = 0; i < 16; i++) {
    const x = 260 + rnd() * (WORLD.width - 520);
    const y = 260 + rnd() * (WORLD.height - 520);
    const rx = 190 + rnd() * 330;
    const ry = rx * (0.55 + rnd() * 0.4);
    const rot = rnd() * Math.PI;
    // keep the spawn plaza free of ice
    const d = Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y);
    if (d < WORLD.spawnRadius + Math.max(rx, ry) + 160) continue;
    lakes.push({ x, y, rx, ry, rot });
  }
  _lakes = lakes;
  return lakes;
}

export function isOnIce(x, y) {
  for (const l of getLakes()) {
    const dx = x - l.x;
    const dy = y - l.y;
    const cos = Math.cos(-l.rot);
    const sin = Math.sin(-l.rot);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if ((lx * lx) / (l.rx * l.rx) + (ly * ly) / (l.ry * l.ry) <= 1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Props: pines, rocks, ice spikes, bushes, snowmen, igloos
 * `r` is the collision radius (0 means walk-through decoration)
 * ------------------------------------------------------------------ */

const PROP_TYPES = [
  { type: 'pine', weight: 46, r: 16 },
  { type: 'rock', weight: 16, r: 20 },
  { type: 'spike', weight: 12, r: 14 },
  { type: 'bush', weight: 14, r: 0 },
  { type: 'snowman', weight: 6, r: 16 },
  { type: 'igloo', weight: 6, r: 46 },
];

let _props = null;

export function getProps() {
  if (_props) return _props;
  const props = [];
  const cell = 150;
  const cols = Math.floor(WORLD.width / cell);
  const rows = Math.floor(WORLD.height / cell);
  const totalWeight = PROP_TYPES.reduce((s, p) => s + p.weight, 0);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const h = hash2(gx, gy, WORLD.seed);
      // density varies across the map so the forest never looks uniform
      const density = fbm(gx * 0.08, gy * 0.08, WORLD.seed ^ 0xf0e57, 3);
      if (h > 0.16 + density * 0.55) continue;

      const x = gx * cell + hash2(gx, gy, WORLD.seed ^ 11) * cell;
      const y = gy * cell + hash2(gx, gy, WORLD.seed ^ 22) * cell;
      if (x < 90 || y < 90 || x > WORLD.width - 90 || y > WORLD.height - 90) continue;
      if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < WORLD.spawnRadius + 60) continue;
      if (isOnIce(x, y)) continue;

      let roll = hash2(gx, gy, WORLD.seed ^ 33) * totalWeight;
      let picked = PROP_TYPES[0];
      for (const p of PROP_TYPES) {
        if (roll < p.weight) {
          picked = p;
          break;
        }
        roll -= p.weight;
      }

      props.push({
        type: picked.type,
        x,
        y,
        r: picked.r,
        scale: 0.8 + hash2(gx, gy, WORLD.seed ^ 44) * 0.5,
        variant: Math.floor(hash2(gx, gy, WORLD.seed ^ 55) * 1000),
      });
    }
  }

  // Hand-placed landmarks around the spawn plaza
  const sx = WORLD.spawn.x;
  const sy = WORLD.spawn.y;
  props.push(
    { type: 'banner', x: sx, y: sy - 215, r: 16, scale: 1, variant: 0 },
    { type: 'igloo', x: sx - 255, y: sy - 95, r: 46, scale: 1.15, variant: 1 },
    { type: 'igloo', x: sx + 258, y: sy - 75, r: 46, scale: 1.05, variant: 2 },
    { type: 'snowman', x: sx - 125, y: sy + 195, r: 16, scale: 1.2, variant: 3 },
    { type: 'snowman', x: sx + 142, y: sy + 198, r: 16, scale: 1.1, variant: 7 },
    { type: 'pine', x: sx - 322, y: sy + 252, r: 16, scale: 1.3, variant: 4 },
    { type: 'pine', x: sx + 330, y: sy + 244, r: 16, scale: 1.25, variant: 5 },
    { type: 'pine', x: sx + 302, y: sy - 292, r: 16, scale: 1.1, variant: 6 },
    { type: 'pine', x: sx - 340, y: sy - 300, r: 16, scale: 1.2, variant: 9 },
  );

  props.sort((a, b) => a.y - b.y);
  _props = props;
  return props;
}

/* Solid props bucketed into a grid for cheap neighbour lookups. */

const SOLID_CELL = 256;
let _solidGrid = null;

function solidGrid() {
  if (_solidGrid) return _solidGrid;
  const grid = new Map();
  for (const p of getProps()) {
    if (!p.r) continue;
    const key = Math.floor(p.x / SOLID_CELL) + ',' + Math.floor(p.y / SOLID_CELL);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(p);
  }
  _solidGrid = grid;
  return grid;
}

export function solidsNear(x, y) {
  const grid = solidGrid();
  const gx = Math.floor(x / SOLID_CELL);
  const gy = Math.floor(y / SOLID_CELL);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = grid.get(gx + dx + ',' + (gy + dy));
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

/**
 * Push a circle out of any solid prop it overlaps, then clamp to the map.
 * Collision runs in flat world space; the tilt is a render-time projection,
 * so footprints are squashed on the y axis to match what the player sees.
 */
export function resolveCollisions(x, y, radius = PLAYER.radius) {
  for (const p of solidsNear(x, y)) {
    const dx = x - p.x;
    const dy = (y - p.y) * 1.7;
    const min = p.r * p.scale + radius;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001 && dist < min) {
      const push = (min - dist) / dist;
      x += dx * push;
      y += (dy * push) / 1.7;
    }
  }
  const m = radius + 24;
  x = Math.min(WORLD.width - m, Math.max(m, x));
  y = Math.min(WORLD.height - m, Math.max(m, y));
  return { x, y };
}

/* ------------------------------------------------------------------ *
 * $POG pickups
 * ------------------------------------------------------------------ */

let _coins = null;

export function getCoins() {
  if (_coins) return _coins;
  const rnd = mulberry32(WORLD.seed ^ 0xc0117);
  const coins = [];
  let guard = 0;
  while (coins.length < COIN.count && guard++ < COIN.count * 60) {
    const x = 220 + rnd() * (WORLD.width - 440);
    const y = 220 + rnd() * (WORLD.height - 440);
    if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < 220) continue;
    let blocked = false;
    for (const p of solidsNear(x, y)) {
      if (Math.hypot(x - p.x, y - p.y) < p.r * p.scale + 40) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    coins.push({ id: coins.length, x, y });
  }
  _coins = coins;
  return coins;
}
