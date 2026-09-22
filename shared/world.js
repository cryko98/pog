// Deterministic world generation shared by the client renderer and the server.
// Same seed in => same frozen world for every player, and no assets to download.

export const WORLD = {
  seed: 20260921,
  width: 6400,
  height: 6400,
  spawn: { x: 3200, y: 3200 },
  spawnRadius: 560,
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
  /** `bonusEvery` levels of the matching skill add one more to the yield */
  tree: { yields: { wood: 2 }, respawnMs: 300000, hits: 5, label: 'Chop', verb: 'chopping', bonusEvery: 3 },
  ice: { yields: { ice: 2 }, respawnMs: 240000, hits: 3, label: 'Cut ice', verb: 'cutting ice', bonusEvery: 3 },
  /**
   * Fishing is not swung. Cast once and a bite comes every `biteMs`; each
   * bite is one server roll on the fish table below — or nothing, if it
   * got away. Holes never deplete: the bite clock is the limit, per wallet.
   */
  hole: { yields: { fish: 1 }, respawnMs: 0, hits: 1, biteMs: 5000, label: 'Fish', verb: 'reeling in', needs: 'rod', bonusEvery: 4 },
};

/* ------------------------------------------------------------------ *
 * What is in the water
 *
 * Every bite rolls once against these weights. The value is how many
 * "fish" the catch is worth in the pack — the cookout, the cairn and the
 * quests all count fish, so a rare one is simply worth more of them.
 * ------------------------------------------------------------------ */

export const RARITY = {
  common: { label: 'Common', color: '#cfe8f5' },
  uncommon: { label: 'Uncommon', color: '#4ade80' },
  rare: { label: 'Rare', color: '#fbbf24' },
  epic: { label: 'Epic', color: '#c084fc' },
  legendary: { label: 'Legendary', color: '#38bdf8' },
};

export const FISH = {
  smelt: { id: 'smelt', label: 'Arctic smelt', rarity: 'common', weight: 52, fish: 1 },
  char: { id: 'char', label: 'Arctic char', rarity: 'common', weight: 28, fish: 1 },
  icefish: { id: 'icefish', label: 'Crocodile icefish', rarity: 'uncommon', weight: 13, fish: 2 },
  trout: { id: 'trout', label: 'Golden trout', rarity: 'rare', weight: 5.5, fish: 3 },
  pike: { id: 'pike', label: 'Glacier pike', rarity: 'epic', weight: 1.3, fish: 6 },
  king: { id: 'king', label: 'The Frost King', rarity: 'legendary', weight: 0.2, fish: 15 },
};

/** The chance a bite comes to nothing, before skill brings it down. */
export const FISH_ESCAPE = 0.3;

export const fishById = (id) => (typeof id === 'string' && Object.hasOwn(FISH, id) ? FISH[id] : null);

/**
 * One bite. `rnd` is supplied so the server decides — the client only
 * ever previews odds. Returns null when it got away. Skill helps twice:
 * fewer escapes, and the rarer rows weigh a little more.
 */
export function rollFish(level = 1, rnd = Math.random) {
  const lv = Math.max(1, Math.floor(level));
  const escape = Math.max(0.1, FISH_ESCAPE - (lv - 1) * 0.02);
  if (rnd() < escape) return null;

  const rows = Object.values(FISH).map((f) => ({
    f,
    w: f.rarity === 'common' ? f.weight : f.weight * (1 + (lv - 1) * 0.06),
  }));
  const total = rows.reduce((s, r) => s + r.w, 0);
  let roll = rnd() * total;
  for (const r of rows) {
    roll -= r.w;
    if (roll <= 0) return r.f;
  }
  return rows[rows.length - 1].f;
}

/** Odds per species at a level, for the tackle-box readout. */
export function fishOdds(level = 1) {
  const lv = Math.max(1, Math.floor(level));
  const rows = Object.values(FISH).map((f) => ({
    f,
    w: f.rarity === 'common' ? f.weight : f.weight * (1 + (lv - 1) * 0.06),
  }));
  const total = rows.reduce((s, r) => s + r.w, 0);
  return rows.map((r) => ({ id: r.f.id, chance: r.w / total }));
}

/* ------------------------------------------------------------------ *
 * Skills
 *
 * One level ladder per thing you can gather, earned by doing it. A
 * higher level takes more out of each node, which is the only reward —
 * it buys speed at the resource loop, and nothing at the Frost ledger.
 *
 * That separation is deliberate. The cairn caps at 30 Frost a day
 * whatever you bring it, so a level-10 woodcutter reaches the cap sooner
 * but never passes it. Skills make the game quicker, not the airdrop
 * bigger.
 * ------------------------------------------------------------------ */

export const SKILLS = {
  tree: { id: 'tree', label: 'Woodcutting', icon: 'wood', verb: 'pines felled' },
  ice: { id: 'ice', label: 'Ice cutting', icon: 'ice', verb: 'blocks cut' },
  hole: { id: 'hole', label: 'Fishing', icon: 'fish', verb: 'fish landed' },
};

/**
 * Completed gathers needed for each level. The steps widen on purpose:
 * the first level is a few minutes, the last is a season.
 */
export const SKILL_XP = [0, 25, 70, 150, 280, 460, 700, 1000, 1400, 1900];
export const SKILL_MAX = SKILL_XP.length;

/** Level, and how far along the bar to the next one. */
export function skillLevel(count = 0) {
  const done = Math.max(0, Math.floor(Number(count) || 0));
  let level = 1;
  for (let i = 0; i < SKILL_XP.length; i++) if (done >= SKILL_XP[i]) level = i + 1;
  const next = level < SKILL_MAX ? SKILL_XP[level] : null;
  const floor = SKILL_XP[level - 1];
  return {
    level,
    count: done,
    next,
    into: done - floor,
    span: next === null ? 0 : next - floor,
  };
}

/** What one completed gather gives, at this skill level. */
export function gatherYield(kind, count = 0) {
  const rule = Object.hasOwn(GATHER, kind) ? GATHER[kind] : null;
  if (!rule) return {};
  const { level } = skillLevel(count);
  const bonus = Math.floor((level - 1) / rule.bonusEvery);
  const out = {};
  for (const [res, base] of Object.entries(rule.yields)) out[res] = base + bonus;
  return out;
}

/**
 * The number over a penguin's head: the three skill levels added up, so
 * it starts at 1 and only moves when you actually work at something.
 */
export function playerLevel(skills = {}) {
  let total = 0;
  for (const kind of Object.keys(SKILLS)) total += skillLevel(skills[kind]).level;
  return total - (Object.keys(SKILLS).length - 1);
}

/** The highest number that formula can produce — every skill maxed. */
export const MAX_PLAYER_LEVEL = Object.keys(SKILLS).length * SKILL_XP.length - (Object.keys(SKILLS).length - 1);

/**
 * Per-minute ceilings on COMPLETED gathers — the individual swings that
 * lead up to one are bounded separately, by SWINGS_PER_MIN.
 */
export const GATHER_PER_MIN = { tree: 12, ice: 12, hole: 13 };
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

/** What each plaza building calls itself, on the sign over its roof. */
export const STATION_SIGNS = {
  craft: 'Workbench',
  shop: 'Hat stall',
  fire: 'Cookout',
  cairn: 'Season cairn',
  furnish: 'Furnishings',
  market: 'Igloo market',
  arena: 'Snowball arena',
};

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

/* ------------------------------------------------------------------ *
 * Furniture, igloo levels and the daily yield
 *
 * Bought with soft $POG at the stall on the plaza ring, placed inside your
 * own igloo, and worth `value` toward its level. The level pays a small
 * daily $POG yield — deliberately a slow payback, so furnishing is a SINK
 * that trickles back rather than a faucet you buy once and farm.
 *
 * Nothing in here touches Frost. An igloo that paid the airdrop ledger
 * would be passive income toward the drop, which is exactly the thing the
 * qualifying gate exists to prevent.
 * ------------------------------------------------------------------ */

export const FURNITURE = {
  rug: { id: 'rug', label: 'Seal-skin rug', blurb: 'Takes the chill off the floor.', price: 8, value: 1, r: 46 },
  brazier: { id: 'brazier', label: 'Stone brazier', blurb: 'A low fire that never quite goes out.', price: 14, value: 2, r: 26 },
  bed: { id: 'bed', label: 'Fur bed', blurb: 'Piled high enough to sleep through a storm.', price: 18, value: 2, r: 40 },
  crate: { id: 'crate', label: 'Driftwood crate', blurb: 'For the haul you have not spent yet.', price: 16, value: 2, r: 24 },
  shelf: { id: 'shelf', label: 'Ice shelf', blurb: 'Carved straight out of the wall.', price: 22, value: 3, r: 34 },
  table: { id: 'table', label: 'Driftwood table', blurb: 'Scarred from a hundred meals.', price: 26, value: 3, r: 32 },
  lamp: { id: 'lamp', label: 'Standing lantern', blurb: 'Warm light, wherever you want it.', price: 30, value: 4, r: 20 },
  banner: { id: 'banner', label: '$POG banner', blurb: 'For the committed.', price: 45, value: 6, r: 30 },
  throne: { id: 'throne', label: 'Ice throne', blurb: 'Cold, and entirely the point.', price: 60, value: 8, r: 34 },
};

/** How many pieces one igloo will hold, so levels need variety not volume. */
export const FURNITURE_LIMIT = 14;

/**
 * Levels are derived from the furniture inside, never stored on their own —
 * a stored level would drift the moment a piece moved.
 */
export const IGLOO_LEVELS = [
  { level: 1, needs: 0, label: 'Shelter', daily: 0 },
  { level: 2, needs: 6, label: 'Den', daily: 1 },
  { level: 3, needs: 14, label: 'Lodge', daily: 2 },
  { level: 4, needs: 26, label: 'Hall', daily: 4 },
  { level: 5, needs: 42, label: 'Palace', daily: 7 },
];

/** At most this many days of yield pile up unclaimed, so you come back. */
export const YIELD_CAP_DAYS = 3;

export function furnitureById(id) {
  return typeof id === 'string' && Object.hasOwn(FURNITURE, id) ? FURNITURE[id] : null;
}

/** Total `value` of everything standing in an igloo. */
export function furnitureValue(pieces = []) {
  let total = 0;
  for (const piece of pieces) {
    const spec = furnitureById(piece?.id);
    if (spec) total += spec.value;
  }
  return total;
}

/** The level an igloo has earned, and how far it is from the next one. */
export function iglooLevel(pieces = []) {
  const value = furnitureValue(pieces);
  let current = IGLOO_LEVELS[0];
  for (const tier of IGLOO_LEVELS) if (value >= tier.needs) current = tier;
  const next = IGLOO_LEVELS.find((t) => t.needs > value) ?? null;
  return { ...current, value, next };
}

/**
 * $POG owed for the time since `since`, capped so an igloo left alone for
 * a month pays the same as one left alone for three days.
 */
export function yieldOwed(pieces, since, now = Date.now()) {
  const { daily } = iglooLevel(pieces);
  if (!daily || !since) return 0;
  const days = Math.min(YIELD_CAP_DAYS, (now - since) / 86_400_000);
  return Math.max(0, Math.floor(daily * days));
}

/**
 * Settle the yield: what to pay, and where the clock moves to.
 *
 * The clock only moves by the whole days actually paid for, so a player who
 * checks in twice a day is not forfeiting half a day each time. Past the
 * cap it jumps to now — the excess is forfeited by design, that is what the
 * cap is for. And when the level is about to change (`reset`), it always
 * jumps to now: the time accrued at the old rate is paid at the old rate,
 * and the new rate starts from zero. Without that, a Shelter that sat empty
 * for three days paid three days of Palace the moment it was furnished.
 */
export function settleYieldAt(pieces, since, now = Date.now(), reset = false) {
  const { daily } = iglooLevel(pieces);
  const from = since || now;
  const elapsedDays = (now - from) / 86_400_000;
  const paid = daily ? Math.max(0, Math.floor(daily * Math.min(YIELD_CAP_DAYS, elapsedDays))) : 0;
  const next =
    reset || !daily || elapsedDays >= YIELD_CAP_DAYS
      ? now
      : from + Math.floor((paid / daily) * 86_400_000);
  return { paid, next };
}

/** Can a piece stand here? Room bounds, clear of the door, clear of others. */
export function canPlaceFurniture(x, y, spec, others = []) {
  if (!spec) return { ok: false, reason: 'No such furnishing.' };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: 'Where?' };

  const { rx, ry, doorWidth } = IGLOO.interior;
  const margin = spec.r + 12;
  if ((x / (rx - margin)) ** 2 + (y / (ry - margin)) ** 2 > 1) {
    return { ok: false, reason: 'That is in the wall.' };
  }
  // keep the doorway walkable, or you can furnish yourself in
  if (Math.abs(x) < doorWidth / 2 + spec.r && y > ry - 70) {
    return { ok: false, reason: 'Keep the doorway clear.' };
  }
  for (const other of others) {
    const os = furnitureById(other.id);
    if (!os) continue;
    if (Math.hypot(x - other.x, y - other.y) < spec.r + os.r) {
      return { ok: false, reason: 'Something is already there.' };
    }
  }
  return { ok: true, reason: '' };
}

export const IGLOO = {
  /** the dome is solid: this is its footprint, in flat world units */
  solidRadius: 74,
  /**
   * Stand this close and E takes you inside. Generous on purpose: the
   * door faces the camera, but a player who has walked round the back and
   * pressed E deserves to get in rather than to wonder why nothing
   * happened.
   */
  doorRange: 130,
  /**
   * The room you find in there. Its own little coordinate space, centred
   * on (0, 0), with the doorway at the bottom — walk into it to leave.
   * Rendered through the same y-squash as the world, so a circle of these
   * proportions reads as a round room seen at a tilt.
   */
  interior: {
    rx: 260,
    ry: 185,
    doorWidth: 124,
    /** how far past the wall you must step to trigger the way out */
    doorDepth: 26,
  },
  /**
   * Half the dome's VISUAL width, which is what has to clear the scenery.
   * The dome is drawn 168 wide, so anything closer than this to another
   * thing's footprint overlaps it on screen however walkable the gap is.
   */
  footprint: 88,
  /** an igloo needs this much clear snow around it — two footprints, plus air */
  clearance: 190,
  /** and this much distance from the spawn plaza */
  plazaGap: 120,
  styles: ['classic', 'frost', 'amber'],
};

/**
 * Push a walker out of any igloo dome it has walked into.
 *
 * Igloos are not in `getProps()` — they arrive from the API and the
 * presence channel and change while you play — so `resolveCollisions`
 * cannot know about them. Same y-squash convention as the props: the tilt
 * is a render-time projection, so footprints are squashed to match.
 */
/**
 * How much room each resource node takes on the ground. Trees are absent
 * on purpose: a pine is already a solid prop and its node rides on it.
 *
 * A cut block leaves nothing but a scar in the ice, so it stops being
 * solid while it is on cooldown. A fished hole is still a hole.
 */
export const NODE_SOLID = { ice: 34, hole: 38 };

/**
 * Push a walker out of the ice blocks and the fishing holes. Same
 * squashed-footprint convention as everything else — the tilt is a
 * render-time projection, so the ground shape is squashed on y to match.
 *
 * @param {number} x
 * @param {number} y
 * @param {(id: string) => boolean} [isDepleted] is this block already cut?
 * @param {number} [radius]
 */
export function resolveNodes(x, y, isDepleted = () => false, radius = PLAYER.radius) {
  for (const node of nodesNear(x, y, 160)) {
    const solid = NODE_SOLID[node.type];
    if (!solid) continue;
    if (node.type === 'ice' && isDepleted(node.id)) continue;

    const dx = x - node.x;
    const dy = (y - node.y) * 1.7;
    const min = solid + radius;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.0001 && dist < min) {
      const push = (min - dist) / dist;
      x += dx * push;
      y += (dy * push) / 1.7;
    }
  }
  return { x, y };
}

export function resolveIgloos(x, y, igloos, radius = PLAYER.radius) {
  for (const igloo of igloos) {
    const dx = x - igloo.x;
    const dy = (y - igloo.y) * 1.7;
    const min = IGLOO.solidRadius + radius;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) {
      // Dead centre, which is exactly where you are standing the moment
      // you raise one. Nudge out of the front, not nowhere.
      y = igloo.y + min / 1.7;
    } else if (dist < min) {
      const push = (min - dist) / dist;
      x += dx * push;
      y += (dy * push) / 1.7;
    }
  }
  return { x, y };
}

/** Which igloo, if any, is close enough to step into from here. */
export function iglooAt(x, y, igloos) {
  let best = null;
  let bestDist = IGLOO.doorRange;
  for (const igloo of igloos) {
    // the door faces the camera, so favour standing in front of it
    const d = Math.hypot(x - igloo.x, (y - igloo.y - 30) * 1.25);
    if (d < bestDist) {
      bestDist = d;
      best = igloo;
    }
  }
  return best;
}

/** Keep a walker inside the room, and say when they have stepped out. */
export function resolveInterior(x, y, radius = PLAYER.radius) {
  const { rx, ry, doorWidth, doorDepth } = IGLOO.interior;
  const inDoorway = Math.abs(x) < doorWidth / 2;

  // the doorway is a gap in the wall, so walking into it is how you leave
  if (inDoorway && y > ry - radius) {
    if (y > ry + doorDepth) return { x, y, leaving: true };
    return { x, y, leaving: false };
  }

  const ex = (x / (rx - radius)) ** 2 + (y / (ry - radius)) ** 2;
  if (ex > 1) {
    const k = 1 / Math.sqrt(ex);
    return { x: x * k, y: y * k, leaving: false };
  }
  return { x, y, leaving: false };
}

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
  // Measured against what you can SEE, not what you bump into. The
  // collision radius of a market stall is a fraction of its awning, so
  // checking against that let an igloo sit halfway through the shopfront.
  // `propsNear` rather than `solidsNear` for the same reason: a bush you
  // can walk through is still a bush growing out of your wall.
  for (const p of propsNear(x, y)) {
    if (Math.hypot(x - p.x, y - p.y) < IGLOO.footprint + footprintOf(p)) {
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
  market: 54,
  campfire: 44,
  cairn: 40,
  furnishop: 54,
  arena: 76,
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
  const RING = 400;
  const RING_Y = 0.82; // the plaza is painted as an ellipse; follow it
  const onRing = (deg) => ({
    x: sx + Math.cos((deg * Math.PI) / 180) * RING,
    y: sy + Math.sin((deg * Math.PI) / 180) * RING * RING_Y,
  });

  const landmarks = [
    // Six trades, evenly spaced, so the plaza reads as a square of shops
    // rather than a pile. The banner comes off the ring and back to the
    // middle, where it is a landmark instead of a seventh shopfront.
    { type: 'workbench', ...onRing(210), r: 30, scale: 1, variant: 0 },
    { type: 'stall', ...onRing(270), r: 32, scale: 1, variant: 0 },
    { type: 'furnishop', ...onRing(330), r: 34, scale: 1, variant: 0 },
    { type: 'market', ...onRing(30), r: 32, scale: 1, variant: 0 },
    { type: 'campfire', ...onRing(90), r: 24, scale: 1, variant: 0 },
    { type: 'cairn', ...onRing(150), r: 22, scale: 1, variant: 0 },
    // The arena sits off the ring, out past the lanterns: it is somewhere
    // you go to, not a shop you pass.
    { type: 'arena', x: sx + 690, y: sy + 20, r: 58, scale: 1, variant: 0 },
    { type: 'banner', x: sx, y: sy - 150, r: 16, scale: 1, variant: 0 },
    { type: 'snowman', x: sx - 150, y: sy + 140, r: 16, scale: 1.2, variant: 3 },
    { type: 'snowman', x: sx + 158, y: sy + 142, r: 16, scale: 1.1, variant: 7 },
    { type: 'pine', x: sx - 452, y: sy + 332, r: 16, scale: 1.3, variant: 4 },
    { type: 'pine', x: sx + 460, y: sy + 324, r: 16, scale: 1.25, variant: 5 },
    { type: 'pine', x: sx + 432, y: sy - 392, r: 16, scale: 1.1, variant: 6 },
    { type: 'pine', x: sx - 470, y: sy - 400, r: 16, scale: 1.2, variant: 9 },
  ];
  // ice lanterns ring the plaza, just inside the painted edge
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    landmarks.push({
      type: 'lantern',
      x: sx + Math.cos(a) * 500,
      y: sy + Math.sin(a) * 500 * RING_Y,
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
 * Every prop nearby, walkable or not. `solidsNear` is for collision and
 * skips the decorative ones; placement cares about what is visible, and a
 * bush you can walk through still looks wrong under a dome.
 */
const ALL_CELL = 256;
let _allGrid = null;

export function propsNear(x, y) {
  if (!_allGrid) {
    _allGrid = new Map();
    for (const p of getProps()) {
      const key = Math.floor(p.x / ALL_CELL) + ',' + Math.floor(p.y / ALL_CELL);
      let bucket = _allGrid.get(key);
      if (!bucket) {
        bucket = [];
        _allGrid.set(key, bucket);
      }
      bucket.push(p);
    }
  }
  const gx = Math.floor(x / ALL_CELL);
  const gy = Math.floor(y / ALL_CELL);
  const out = [];
  // the widest footprint is the banner at 80, and an igloo reaches 88, so
  // two rings of cells is the smallest that cannot miss a neighbour
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const bucket = _allGrid.get(gx + dx + ',' + (gy + dy));
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
  // Stations are the props, so read their positions from the same place
  // rather than repeating the arithmetic and letting the two drift.
  const stationOf = {
    workbench: 'craft',
    stall: 'shop',
    campfire: 'fire',
    cairn: 'cairn',
    furnishop: 'furnish',
    market: 'market',
    arena: 'arena',
  };
  for (const prop of getProps()) {
    const kind = stationOf[prop.type];
    if (kind) nodes.push({ id: 'station-' + kind, type: kind, x: prop.x, y: prop.y });
  }

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
