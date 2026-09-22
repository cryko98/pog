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
  maxSpeed: 430,
  /** Penguins belly-slide: ice is faster than snow, and far less grippy. */
  iceSpeedBoost: 1.55,
  snowGrip: 13, // how fast velocity chases input (higher = tighter)
  iceGrip: 1.4,
};

/**
 * $POG coins are the cosmetic currency — the only thing they buy is skins.
 * They are deliberately scarce: the day-to-day loop is gathering wood, ice
 * and fish, not hoovering up coins.
 */
export const COIN = {
  radius: 18,
  pickupRadius: 52,
  respawnMs: 240000,
  count: 70,
  value: 1,
};

/* ------------------------------------------------------------------ *
 * Gathering, crafting and building
 * ------------------------------------------------------------------ */

export const GATHER = {
  /** how close you must stand to work a node */
  range: 86,
  /** how long a swing takes, and how many land before the node gives way */
  swingMs: 420,
  tree: { yields: { wood: 2 }, respawnMs: 300000, hits: 5, label: 'Chop', verb: 'chopping' },
  ice: { yields: { ice: 2 }, respawnMs: 240000, hits: 3, label: 'Cut ice', verb: 'cutting ice' },
  hole: { yields: { fish: 1 }, respawnMs: 180000, hits: 3, label: 'Fish', verb: 'reeling in', needs: 'rod' },
};

/**
 * Per-minute ceilings on COMPLETED gathers — the individual swings that
 * lead up to one are bounded separately, by SWINGS_PER_MIN.
 */
export const GATHER_PER_MIN = { tree: 12, ice: 12, hole: 6 };
export const SWINGS_PER_MIN = 110;

/**
 * `station` decides which panel a recipe shows up in — the workbench makes
 * things, the plaza fire turns a catch into $POG. `gives` may name a crafted
 * item (rod, iglooKit) or a resource the profile already tracks (pog); the
 * server tells them apart by key.
 */
export const RECIPES = {
  rod: {
    id: 'rod',
    label: 'Fishing rod',
    blurb: 'Lets you fish the holes out on the lakes.',
    station: 'craft',
    cost: { wood: 25 },
    gives: { rod: 1 },
  },
  iglooKit: {
    id: 'iglooKit',
    label: 'Igloo kit',
    blurb: 'A season of logging and ice-cutting. Raise your own igloo on the snow.',
    station: 'craft',
    cost: { wood: 300, ice: 120 },
    gives: { iglooKit: 1 },
  },
  cookout: {
    id: 'cookout',
    label: 'Cookout',
    blurb: 'Smoke five fish over the plaza fire and the crowd tips you in $POG.',
    station: 'fire',
    cost: { fish: 5 },
    gives: { pog: 1 },
  },
  feast: {
    id: 'feast',
    label: 'Midwinter feast',
    blurb: 'Empty the whole catch onto the coals. Worth more per fish than a cookout.',
    station: 'fire',
    cost: { fish: 30 },
    gives: { pog: 7 },
  },
};

/** Which profile fields a recipe may pay out into; anything else is an item. */
export const RESOURCE_KEYS = ['pog', 'wood', 'ice', 'fish'];

/* ------------------------------------------------------------------ *
 * Daily quests
 *
 * Three a day, drawn deterministically from the wallet address and the
 * UTC date. That matters: a player cannot reroll into easy ones by
 * logging out, and the server can recompute the same three from scratch
 * instead of trusting a list the client sends it.
 * ------------------------------------------------------------------ */

export const QUEST_POOL = [
  { id: 'chop', track: 'tree', icon: 'wood', label: 'Fell {n} pine{s}', targets: [8, 12, 16], reward: 3 },
  { id: 'cut', track: 'ice', icon: 'ice', label: 'Cut {n} block{s} of ice', targets: [6, 10, 14], reward: 3 },
  { id: 'fish', track: 'hole', icon: 'fish', label: 'Land {n} fish', targets: [3, 5, 7], reward: 4 },
  { id: 'coins', track: 'coin', icon: 'coin', label: 'Pocket {n} $POG coin{s}', targets: [2, 4, 6], reward: 2 },
  { id: 'craft', track: 'craft', icon: 'rod', label: 'Craft {n} item{s}', targets: [1, 2], reward: 3 },
];

export const DAILY_QUESTS = 3;
/** Every consecutive day of clearing all three adds one, up to this. */
export const STREAK_BONUS_CAP = 5;

/** UTC calendar day — one rollover for everyone, wherever they live. */
export function questDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The three quests this wallet has today. Same input => same three. */
export function dailyQuests(wallet, day = questDay()) {
  const rnd = mulberry32(hashStr(String(wallet) + '|' + day));
  const pool = QUEST_POOL.slice();
  const out = [];
  while (out.length < DAILY_QUESTS && pool.length) {
    const [pick] = pool.splice(Math.floor(rnd() * pool.length), 1);
    const target = pick.targets[Math.floor(rnd() * pick.targets.length)];
    out.push({
      id: pick.id,
      track: pick.track,
      icon: pick.icon,
      reward: pick.reward,
      target,
      label: pick.label.replace('{n}', String(target)).replace('{s}', target === 1 ? '' : 's'),
    });
  }
  return out;
}

export const IGLOO = {
  /** an igloo needs this much clear snow around it */
  clearance: 150,
  /** and this much distance from the spawn plaza */
  plazaGap: 120,
  /** and this much room from trees, rocks and the like */
  propGap: 70,
  styles: ['classic', 'frost', 'amber'],
};

/**
 * Can an igloo stand here? Shared so the ghost preview the player drags
 * around and the API that finally accepts the build apply the same rules —
 * no "it looked fine and then the server said no".
 *
 * `others` is every igloo already standing, excluding your own.
 */
export function canBuildAt(x, y, others = []) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'Where are you?' };
  if (x < 120 || y < 120 || x > WORLD.width - 120 || y > WORLD.height - 120) {
    return { ok: false, reason: 'Too close to the edge of the world.' };
  }
  if (isOnIce(x, y, 40)) return { ok: false, reason: 'You cannot build on a frozen lake.' };
  if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < WORLD.spawnRadius + IGLOO.plazaGap) {
    return { ok: false, reason: 'The spawn plaza has to stay clear.' };
  }
  for (const p of solidsNear(x, y)) {
    if (Math.hypot(x - p.x, y - p.y) < p.r * p.scale + IGLOO.propGap) {
      return { ok: false, reason: 'Something is in the way.' };
    }
  }
  for (const other of others) {
    if (Math.hypot(x - other.x, y - other.y) < IGLOO.clearance) {
      return { ok: false, reason: `${other.owner || 'Someone'} already built here.` };
    }
  }
  return { ok: true, reason: '' };
}

export const SKINS = [
  { id: 'default', label: 'Plain penguin', price: 0, kind: 'hat', hat: null },
  { id: 'beanie', label: 'Wool beanie', price: 12, kind: 'hat', hat: 'beanie' },
  { id: 'santa', label: 'Santa hat', price: 20, kind: 'hat', hat: 'santa' },
  { id: 'earmuffs', label: 'Earmuffs', price: 16, kind: 'hat', hat: 'earmuffs' },
  { id: 'crown', label: 'Ice crown', price: 45, kind: 'hat', hat: 'crown' },
  { id: 'cap', label: 'Backwards cap', price: 18, kind: 'hat', hat: 'cap' },
];

export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

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

/** Clear water between two lakes, so their snow banks never grow together. */
const LAKE_GAP = 220;
const TARGET_LAKES = 16;

let _lakes = null;

export function getLakes() {
  if (_lakes) return _lakes;
  const rnd = mulberry32(WORLD.seed ^ 0x1ce1a);
  const lakes = [];

  // Rejection sampling: keep drawing candidates and throw away any that would
  // touch an existing lake or the spawn plaza. Bounding circles make the test
  // conservative, which is what we want — two lakes never share a shoreline.
  let guard = 0;
  while (lakes.length < TARGET_LAKES && guard++ < TARGET_LAKES * 120) {
    const x = 320 + rnd() * (WORLD.width - 640);
    const y = 320 + rnd() * (WORLD.height - 640);
    const rx = 190 + rnd() * 330;
    const ry = rx * (0.55 + rnd() * 0.4);
    const rot = rnd() * Math.PI;
    const reach = Math.max(rx, ry);

    if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < WORLD.spawnRadius + reach + 200) continue;

    let clash = false;
    for (const l of lakes) {
      if (Math.hypot(x - l.x, y - l.y) < reach + Math.max(l.rx, l.ry) + LAKE_GAP) {
        clash = true;
        break;
      }
    }
    if (clash) continue;

    lakes.push({ x, y, rx, ry, rot, reach });
  }

  _lakes = lakes;
  return lakes;
}

/**
 * Is (x, y) on a frozen lake? `margin` inflates every lake, which is how props
 * are kept off the shoreline instead of hanging over the edge.
 */
export function isOnIce(x, y, margin = 0) {
  for (const l of getLakes()) {
    const dx = x - l.x;
    const dy = y - l.y;
    const cos = Math.cos(-l.rot);
    const sin = Math.sin(-l.rot);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const rx = l.rx + margin;
    const ry = l.ry + margin;
    if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Props: pines, rocks, ice spikes, bushes, snowmen, plaza lanterns
 * `r` is the collision radius (0 means walk-through decoration)
 * ------------------------------------------------------------------ */

// No igloos: shelters are something players will build themselves later, so
// the world deliberately leaves that space empty.
const PROP_TYPES = [
  { type: 'pine', weight: 48, r: 16 },
  { type: 'rock', weight: 17, r: 20 },
  { type: 'spike', weight: 14, r: 14 },
  { type: 'bush', weight: 15, r: 0 },
  { type: 'snowman', weight: 6, r: 16 },
];

/**
 * How much room each prop needs around it. This is the *visual* width, which
 * is wider than the collision radius — a pine you can squeeze past still looks
 * wrong growing through its neighbour.
 */
const FOOTPRINT = {
  pine: 34,
  rock: 32,
  spike: 22,
  bush: 26,
  snowman: 24,
  lantern: 18,
  banner: 80,
  workbench: 46,
  stall: 52,
  campfire: 44,
};

const footprintOf = (p) => (FOOTPRINT[p.type] ?? 24) * p.scale;

/** Props must stay this far back from a shoreline. */
const SHORE_MARGIN = 34;

let _props = null;

export function getProps() {
  if (_props) return _props;

  const placed = [];
  const spacing = new Map(); // grid of accepted props, for cheap distance checks
  const SPACING_CELL = 128;

  const remember = (p) => {
    const key = Math.floor(p.x / SPACING_CELL) + ',' + Math.floor(p.y / SPACING_CELL);
    let bucket = spacing.get(key);
    if (!bucket) {
      bucket = [];
      spacing.set(key, bucket);
    }
    bucket.push(p);
    placed.push(p);
  };

  /** True when the candidate would visually overlap something already placed. */
  const crowded = (candidate) => {
    const need = footprintOf(candidate);
    const gx = Math.floor(candidate.x / SPACING_CELL);
    const gy = Math.floor(candidate.y / SPACING_CELL);
    // the largest footprint is the banner at 80, so one ring of cells is not
    // always enough — two covers every case at this cell size
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const bucket = spacing.get(gx + dx + ',' + (gy + dy));
        if (!bucket) continue;
        for (const other of bucket) {
          if (Math.hypot(candidate.x - other.x, candidate.y - other.y) < need + footprintOf(other)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Landmarks go down first so the scattered pass has to work around them.
  const sx = WORLD.spawn.x;
  const sy = WORLD.spawn.y;
  const landmarks = [
    { type: 'banner', x: sx, y: sy - 215, r: 16, scale: 1, variant: 0 },
    // the two places you actually do business
    { type: 'workbench', x: sx - 205, y: sy - 55, r: 30, scale: 1, variant: 0 },
    { type: 'stall', x: sx + 205, y: sy - 55, r: 32, scale: 1, variant: 0 },
    // a catch is worth nothing raw; the fire is where fish becomes $POG
    { type: 'campfire', x: sx, y: sy + 120, r: 24, scale: 1, variant: 0 },
    { type: 'snowman', x: sx - 118, y: sy + 150, r: 16, scale: 1.2, variant: 3 },
    { type: 'snowman', x: sx + 132, y: sy + 152, r: 16, scale: 1.1, variant: 7 },
    { type: 'pine', x: sx - 322, y: sy + 252, r: 16, scale: 1.3, variant: 4 },
    { type: 'pine', x: sx + 330, y: sy + 244, r: 16, scale: 1.25, variant: 5 },
    { type: 'pine', x: sx + 302, y: sy - 292, r: 16, scale: 1.1, variant: 6 },
    { type: 'pine', x: sx - 340, y: sy - 300, r: 16, scale: 1.2, variant: 9 },
  ];
  // ice lanterns ring the plaza where the igloos used to stand
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    landmarks.push({
      type: 'lantern',
      x: sx + Math.cos(a) * 292,
      y: sy + Math.sin(a) * 292 * 0.82,
      r: 10,
      scale: 1,
      variant: i,
    });
  }
  // the same spacing rule applies to landmarks, so the invariant holds for
  // every prop in the world rather than just the generated ones
  for (const l of landmarks) if (!crowded(l)) remember(l);

  // Scattered world props on a jittered grid.
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
      if (isOnIce(x, y, SHORE_MARGIN)) continue;

      let roll = hash2(gx, gy, WORLD.seed ^ 33) * totalWeight;
      let picked = PROP_TYPES[0];
      for (const p of PROP_TYPES) {
        if (roll < p.weight) {
          picked = p;
          break;
        }
        roll -= p.weight;
      }

      const candidate = {
        type: picked.type,
        x,
        y,
        r: picked.r,
        scale: 0.8 + hash2(gx, gy, WORLD.seed ^ 44) * 0.5,
        variant: Math.floor(hash2(gx, gy, WORLD.seed ^ 55) * 1000),
      };
      if (crowded(candidate)) continue;
      remember(candidate);
    }
  }

  placed.sort((a, b) => a.y - b.y);
  _props = placed;
  return placed;
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

/* ------------------------------------------------------------------ *
 * Resource nodes
 *
 * Derived from the same seed, so the client and the API agree on which
 * node ids exist and where they are. The API cannot see you standing
 * there, but it can check the node is real and that you claimed to be
 * within range of it.
 * ------------------------------------------------------------------ */

let _nodes = null;
let _nodeById = null;

export function getNodes() {
  if (_nodes) return _nodes;
  const nodes = [];

  // The plaza stations are interactable the same way resource nodes are —
  // walk up, press E — they just open a panel instead of yielding anything.
  nodes.push(
    { id: 'station-craft', type: 'craft', x: WORLD.spawn.x - 205, y: WORLD.spawn.y - 55 },
    { id: 'station-shop', type: 'shop', x: WORLD.spawn.x + 205, y: WORLD.spawn.y - 55 },
    { id: 'station-fire', type: 'fire', x: WORLD.spawn.x, y: WORLD.spawn.y + 120 }
  );

  // Every pine is choppable.
  getProps().forEach((p, i) => {
    if (p.type === 'pine') nodes.push({ id: 't' + i, type: 'tree', x: p.x, y: p.y });
  });

  // Ice blocks and fishing holes sit out on the frozen lakes.
  getLakes().forEach((lake, li) => {
    const rnd = mulberry32((WORLD.seed ^ 0xf1a5) + li * 7919);
    const placed = [];
    const spot = (maxTries) => {
      for (let i = 0; i < maxTries; i++) {
        // keep clear of the shoreline so nodes never poke out onto snow
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.78;
        const lx = Math.cos(a) * lake.rx * r;
        const ly = Math.sin(a) * lake.ry * r;
        const cos = Math.cos(lake.rot);
        const sin = Math.sin(lake.rot);
        const x = lake.x + lx * cos - ly * sin;
        const y = lake.y + lx * sin + ly * cos;
        if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > 130)) {
          placed.push({ x, y });
          return { x, y };
        }
      }
      return null;
    };

    const holes = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < holes; i++) {
      const s = spot(30);
      if (s) nodes.push({ id: `h${li}_${i}`, type: 'hole', x: s.x, y: s.y });
    }
    const blocks = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < blocks; i++) {
      const s = spot(30);
      if (s) nodes.push({ id: `i${li}_${i}`, type: 'ice', x: s.x, y: s.y });
    }
  });

  _nodes = nodes;
  _nodeById = new Map(nodes.map((n) => [n.id, n]));
  return nodes;
}

export function getNode(id) {
  if (!_nodeById) getNodes();
  return _nodeById.get(id) || null;
}

/** Nodes near a point, for the client's "what can I interact with" check. */
export function nodesNear(x, y, radius) {
  return getNodes().filter((n) => Math.hypot(n.x - x, n.y - y) <= radius);
}

/** Coins keep this far from each other so two never render as one blob. */
const COIN_GAP = 150;

export function getCoins() {
  if (_coins) return _coins;
  const rnd = mulberry32(WORLD.seed ^ 0xc0117);
  const coins = [];
  const grid = new Map();
  const CELL = 256;

  const nearbyCoins = (x, y) => {
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = grid.get(gx + dx + ',' + (gy + dy));
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  };

  let guard = 0;
  while (coins.length < COIN.count && guard++ < COIN.count * 120) {
    const x = 220 + rnd() * (WORLD.width - 440);
    const y = 220 + rnd() * (WORLD.height - 440);
    if (Math.hypot(x - WORLD.spawn.x, y - WORLD.spawn.y) < 220) continue;

    // clear of props, and never straddling a shoreline
    let blocked = isOnIce(x, y) !== isOnIce(x, y + 30);
    if (!blocked) {
      for (const p of solidsNear(x, y)) {
        if (Math.hypot(x - p.x, y - p.y) < p.r * p.scale + 46) {
          blocked = true;
          break;
        }
      }
    }
    if (!blocked) {
      for (const c of nearbyCoins(x, y)) {
        if (Math.hypot(x - c.x, y - c.y) < COIN_GAP) {
          blocked = true;
          break;
        }
      }
    }
    if (blocked) continue;

    const coin = { id: coins.length, x, y };
    coins.push(coin);
    const key = Math.floor(x / CELL) + ',' + Math.floor(y / CELL);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(coin);
  }

  _coins = coins;
  return coins;
}
