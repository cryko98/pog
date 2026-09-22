// Tilted top-down renderer + client-side simulation.
// The world is flat; the "3/4 view" comes from squashing the y axis on screen
// while props and penguins stay upright. Depth = world y.

import {
  WORLD,
  PLAYER,
  COIN,
  getCoins,
  getProps,
  getLakes,
  getNodes,
  isOnIce,
  resolveCollisions,
  GATHER,
  IGLOO,
  RECIPES,
  canBuildAt,
} from '../../shared/world.js';
import { blitPenguin, type Dir } from './penguin';
import {
  CHUNK,
  drawCoin,
  drawIgloo,
  drawIglooGhost,
  drawNode,
  drawProp,
  drawStump,
  getGroundChunk,
  type Prop,
  type WorldNode,
} from './scenery';
import {
  announceCoin,
  presenceConnected,
  publishPresence,
  sendChat,
  subscribeChat,
  subscribeCoins,
  subscribePresence,
  trackOnline,
  announceNode,
  subscribeNodes,
  announceIgloo,
  subscribeIgloos,
  type IglooMsg,
  type Presence,
} from './presence';
import { api, type QuestBoard } from '../lib/api';

export const Y_SCALE = 0.62;
const ZOOM = 1;
const PENGUIN_WORLD_HEIGHT = 78;
const HEARTBEAT_MS = 25_000;

export interface Inventory {
  pog: number;
  wood: number;
  ice: number;
  fish: number;
  items: Record<string, number>;
}

export interface HudState {
  online: number;
  pog: number;
  status: 'connecting' | 'open' | 'closed';
  x: number;
  y: number;
  onIce: boolean;
  inventory: Inventory;
  /** what pressing E would do right now, if anything */
  prompt: string;
  busy: boolean;
  /** placement mode for an igloo */
  building: boolean;
  buildOk: boolean;
  buildReason: string;
}

export interface ChatLine {
  id: string;
  name?: string;
  color?: string;
  text: string;
  system?: boolean;
}

interface Remote extends Presence {
  rx: number; // rendered position, lerped toward x/y
  ry: number;
  frame: number;
  anim: number;
}

interface Options {
  /** wallet address, or a local guest id — also this penguin's presence id */
  id: string;
  name: string;
  color: string;
  pog: number;
  /** guests can roam and chat, but $POG is only ever credited to a wallet */
  guest: boolean;
  onHud: (hud: HudState) => void;
  onChat: (line: ChatLine) => void;
  onFatal: (message: string) => void;
  /** walking up to the bench, the stall or the fire opens the matching panel */
  onStation: (which: StationKind) => void;
  /** today's quests, whenever the server's view of them changes */
  onQuests: (board: QuestBoard) => void;
}

export type StationKind = 'craft' | 'shop' | 'fire';

const STATION_KINDS: StationKind[] = ['craft', 'shop', 'fire'];
const isStation = (type: string): type is StationKind => STATION_KINDS.includes(type as StationKind);

const STATION_PROMPT: Record<StationKind, string> = {
  craft: 'Press E to use the workbench',
  shop: 'Press E to browse the stall',
  fire: 'Press E to cook at the fire',
};

const DIR_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class PogGame {
  private ctx: CanvasRenderingContext2D;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;

  private selfId: string;
  private detach: Array<() => void> = [];
  private heartbeatTimer = 0;
  private serverOnline = 0;
  private mqttOnline = 1;
  private keys = new Set<string>();
  private touch: { active: boolean; baseX: number; baseY: number; x: number; y: number; id: number } = {
    active: false,
    baseX: 0,
    baseY: 0,
    x: 0,
    y: 0,
    id: -1,
  };

  private me = {
    x: WORLD.spawn.x,
    y: WORLD.spawn.y,
    vx: 0,
    vy: 0,
    dir: 'down' as Dir,
    moving: false,
    frame: 0,
    anim: 0,
    pog: 0,
  };

  private cam = { x: WORLD.spawn.x, y: WORLD.spawn.y };
  private remotes = new Map<string, Remote>();
  private taken = new Set<number>();
  private claiming = new Set<number>();
  private bubbles = new Map<string, { text: string; until: number }>();
  private pickupFx: Array<{ x: number; y: number; t: number; label: string }> = [];
  private snow: Array<{ x: number; y: number; r: number; s: number; d: number }> = [];
  private sinceHud = 0;

  /** Spray kicked up while sliding, in world space. */
  private spray: Array<{ x: number; y: number; vx: number; vy: number; life: number; r: number }> = [];
  private guestCoinNoticeShown = false;

  private props: Prop[] = getProps() as Prop[];
  private coins = getCoins() as Array<{ id: number; x: number; y: number }>;
  private nodes = getNodes() as WorldNode[];
  /** node id -> when it comes back */
  private depleted = new Map<string, number>();
  /** props index -> node id, so a chopped pine renders as a stump */
  private treeNodeByProp = new Map<number, string>();
  private igloos = new Map<string, IglooMsg>();
  private nearNode: WorldNode | null = null;
  private busy = false;
  private inventory: Inventory = { pog: 0, wood: 0, ice: 0, fish: 0, items: {} };
  private hat: string | null = null;
  /** swings landed on the node under us, as the API counts them */
  private hits = new Map<string, { hits: number; needed: number; at: number }>();
  private swingUntil = 0;
  private lastRodNotice = -Infinity;
  private shake = new Map<string, number>();
  private chips: Array<{ x: number; y: number; vx: number; vy: number; life: number; color: string }> = [];
  private building: { style: string } | null = null;
  private buildCheck = { ok: false, reason: '' };
  /** true once the player has touched a control, so we stop relocating them */
  private moved = false;
  private homed = false;
  private questTimer = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: Options) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.me.pog = opts.pog;
    this.selfId = opts.id;

    // spread arrivals around the plaza instead of stacking everyone on one spot
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (WORLD.spawnRadius - 90);
    this.me.x = WORLD.spawn.x + Math.cos(angle) * dist;
    this.me.y = WORLD.spawn.y + Math.sin(angle) * dist * 0.75;
    this.cam.x = this.me.x;
    this.cam.y = this.me.y;

    this.props.forEach((p, i) => {
      if (p.type === 'pine') this.treeNodeByProp.set(i, 't' + i);
    });
  }

  /* ---------------- lifecycle ---------------- */

  start(minimap?: HTMLCanvasElement | null) {
    if (this.running) return;
    this.running = true;
    this.minimapCtx = minimap ? minimap.getContext('2d') : null;

    this.initSnow();
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseKeys);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onPointerUp);

    this.connect();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Join the presence channel and pull the shared bits from the API. */
  private connect() {
    this.detach.push(
      publishPresence(() => ({
        id: this.selfId,
        name: this.opts.name,
        color: this.opts.color,
        x: this.me.x,
        y: this.me.y,
        dir: this.me.dir,
        moving: this.me.moving,
        guest: this.opts.guest,
      })),

      subscribePresence(this.selfId, (players) => {
        const seen = new Set<string>();
        for (const p of players) {
          seen.add(p.id);
          const existing = this.remotes.get(p.id);
          if (existing) Object.assign(existing, p);
          else this.remotes.set(p.id, { ...p, rx: p.x, ry: p.y, frame: 0, anim: 0 });
        }
        // anyone who stopped broadcasting has left the ice
        for (const id of [...this.remotes.keys()]) {
          if (!seen.has(id)) {
            this.remotes.delete(id);
            this.bubbles.delete(id);
          }
        }
      }),

      subscribeChat((m) => {
        this.bubbles.set(m.id, { text: m.text, until: performance.now() + 5200 });
        this.pushChat({ id: crypto.randomUUID(), name: m.name, color: m.color, text: m.text });
      }),

      subscribeCoins((id) => this.taken.add(id)),

      subscribeNodes((id, respawnAt) => this.depleted.set(id, respawnAt)),

      subscribeIgloos((igloo) => this.igloos.set(igloo.wallet, igloo)),

      trackOnline(this.selfId, (count) => {
        this.mqttOnline = count;
      })
    );

    // coins already picked up before we arrived
    api
      .takenCoins()
      .then(({ taken }) => taken.forEach((id) => this.taken.add(id)))
      .catch(() => {});

    // igloos are public, so guests see the neighbourhood too
    api
      .igloos()
      .then(({ igloos }) => igloos.forEach((i) => this.igloos.set(i.wallet, i)))
      .catch(() => {});

    if (!this.opts.guest) this.refreshState();

    const beat = () =>
      api
        .beat(this.selfId)
        .then(({ count }) => {
          this.serverOnline = count;
        })
        .catch(() => {});
    beat();
    this.heartbeatTimer = window.setInterval(beat, HEARTBEAT_MS);

    this.pushChat({ id: crypto.randomUUID(), text: 'You are on the ice. Happy hunting!', system: true });
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseKeys);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.questTimer);
    this.detach.forEach((fn) => fn());
    this.detach = [];
  }

  /** Rename / recolour / re-hat without tearing down the session. */
  setIdentity(name: string, color: string, hat: string | null = this.hat) {
    this.opts.name = name;
    this.opts.color = color;
    this.hat = hat;
  }

  /** Pull inventory, node cooldowns, igloos and today's quests back. */
  async refreshState() {
    if (this.opts.guest) return;
    try {
      const { profile, depleted, igloos, quests } = await api.gameState();
      this.applyProfile(profile);
      const now = Date.now();
      depleted.forEach((id) => {
        if (!this.depleted.has(id)) this.depleted.set(id, now + 60_000);
      });
      igloos.forEach((i) => this.igloos.set(i.wallet, i));
      if (quests) this.opts.onQuests(quests);
      this.goHome();
    } catch {
      /* the world still plays without it */
    }
  }

  /**
   * Players who have built an igloo wake up at their own door rather than
   * back on the plaza — which is most of what makes 300 wood worth
   * spending. Only on arrival: once you have taken a step it would be a
   * teleport, and the server would refuse the next action anyway.
   */
  private goHome() {
    if (this.homed || this.moved) return;
    const home = this.igloos.get(this.selfId);
    if (!home) return;
    this.homed = true;
    // just south of the entrance, clear of the dome itself
    this.me.x = home.x;
    this.me.y = home.y + 64;
    this.me.vx = 0;
    this.me.vy = 0;
    this.cam.x = this.me.x;
    this.cam.y = this.me.y;
    this.pushChat({ id: crypto.randomUUID(), text: 'Home sweet igloo.', system: true });
  }

  /**
   * Quest progress is server-side, so it is re-read rather than guessed at.
   * Debounced: a burst of swings should cost one request, not five.
   */
  private pokeQuests() {
    if (this.opts.guest) return;
    clearTimeout(this.questTimer);
    this.questTimer = window.setTimeout(() => {
      api
        .quests()
        .then((board) => this.opts.onQuests(board))
        .catch(() => {});
    }, 900);
  }

  applyProfile(profile: {
    pog: number;
    wood: number;
    ice: number;
    fish: number;
    items: Record<string, number>;
  }) {
    this.me.pog = profile.pog;
    this.inventory = {
      pog: profile.pog,
      wood: profile.wood,
      ice: profile.ice,
      fish: profile.fish,
      items: profile.items || {},
    };
  }

  /** The node the player is standing next to, if any. */
  private findNearNode(): WorldNode | null {
    let best: WorldNode | null = null;
    let bestDist = GATHER.range;
    for (const n of this.nodes) {
      if (Math.abs(n.x - this.me.x) > GATHER.range || Math.abs(n.y - this.me.y) > GATHER.range) continue;
      const d = Math.hypot(n.x - this.me.x, n.y - this.me.y);
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  private promptFor(node: WorldNode | null): string {
    if (!node) return '';
    if (isStation(node.type)) return STATION_PROMPT[node.type];
    const until = this.depleted.get(node.id);
    if (until && until > Date.now()) {
      return `${Math.ceil((until - Date.now()) / 1000)}s until it is back`;
    }
    const rule = GATHER[node.type as 'tree' | 'ice' | 'hole'];
    if (!rule) return '';
    if (this.opts.guest) return 'Connect a wallet to gather';
    if (node.type === 'hole' && !(this.inventory.items.rod > 0)) return 'You need a fishing rod';
    const progress = this.hits.get(node.id);
    if (progress) return `${rule.label} — ${progress.hits}/${progress.needed}`;
    return `Press E to ${rule.label.toLowerCase()} (${rule.hits} hits)`;
  }

  /** Work the node the player is standing at. */
  private interact() {
    const node = this.nearNode;
    if (!node || this.busy) return;

    if (isStation(node.type)) {
      this.opts.onStation(node.type);
      return;
    }

    if (this.opts.guest) {
      this.notifyGuest();
      return;
    }
    const until = this.depleted.get(node.id);
    if (until && until > Date.now()) return;
    if (node.type === 'hole' && !(this.inventory.items.rod > 0)) {
      // do not repeat this every time the key repeats
      if (performance.now() - this.lastRodNotice > 8000) {
        this.lastRodNotice = performance.now();
        this.pushChat({
          id: crypto.randomUUID(),
          text: `Craft a fishing rod first — ${RECIPES.rod.cost.wood} wood at the workbench.`,
          system: true,
        });
      }
      return;
    }

    this.busy = true;
    this.swingUntil = performance.now() + GATHER.swingMs;

    // land the blow locally straight away: the shake and the chips should
    // not wait on a round trip
    this.shake.set(node.id, performance.now());
    this.throwChips(node);
    this.me.dir = Math.abs(node.x - this.me.x) > Math.abs(node.y - this.me.y)
      ? node.x < this.me.x ? 'left' : 'right'
      : node.y < this.me.y ? 'up' : 'down';

    api
      .gather(node.id, this.me.x, this.me.y)
      .then(({ hits, needed, profile, gained, respawnAt }) => {
        if (profile && gained && respawnAt) {
          this.hits.delete(node.id);
          this.applyProfile(profile);
          this.depleted.set(node.id, respawnAt);
          announceNode(node.id, respawnAt);
          const parts = Object.entries(gained).map(([k, v]) => `+${v} ${k}`);
          this.pickupFx.push({ x: node.x, y: node.y, t: performance.now(), label: parts.join(' ') });
          this.pokeQuests();
        } else if (typeof hits === 'number' && typeof needed === 'number') {
          this.hits.set(node.id, { hits, needed, at: performance.now() });
        }
      })
      .catch((err: Error) => {
        this.hits.delete(node.id);
        // a refusal is normal here (rate caps, someone beat you to it), so
        // only surface the ones a player can act on
        if (!/Slow down/i.test(err.message)) {
          this.pushChat({ id: crypto.randomUUID(), text: err.message, system: true });
        }
      })
      .finally(() => {
        this.busy = false;
      });
  }

  /** A short sideways judder on whatever just took a hit. */
  private shakeOffset(nodeId: string, now: number): number {
    const at = this.shake.get(nodeId);
    if (at === undefined) return 0;
    const t = now - at;
    if (t > 260) {
      this.shake.delete(nodeId);
      return 0;
    }
    return Math.sin(t * 0.06) * 5 * (1 - t / 260) * ZOOM;
  }

  /** Little pips over a node showing swings landed out of swings needed. */
  private drawHitGauge(x: number, y: number, hits: number, needed: number) {
    const ctx = this.ctx;
    const r = 4 * ZOOM;
    const gap = 11 * ZOOM;
    const total = (needed - 1) * gap;

    ctx.save();
    for (let i = 0; i < needed; i++) {
      const px = x - total / 2 + i * gap;
      ctx.beginPath();
      ctx.arc(px, y, r, 0, Math.PI * 2);
      if (i < hits) {
        ctx.fillStyle = '#ffc93c';
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(9,41,48,0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Can we actually put a swing into this right now? */
  private canWork(node: WorldNode): boolean {
    if (this.opts.guest) return false;
    const until = this.depleted.get(node.id);
    if (until && until > Date.now()) return false;
    if (node.type === 'hole' && !(this.inventory.items.rod > 0)) return false;
    return true;
  }

  /** Splinters, ice shards or spray, depending on what you just hit. */
  private throwChips(node: WorldNode) {
    const color = node.type === 'tree' ? '#8a6a48' : node.type === 'ice' ? '#dff3ff' : '#7fd4f0';
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 70 + Math.random() * 120;
      this.chips.push({
        x: node.x,
        y: node.y - 10,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.55,
        life: 0.35 + Math.random() * 0.3,
        color,
      });
    }
  }

  /** Craft a recipe, then reflect the new inventory. */
  async craft(recipe: string): Promise<string | null> {
    try {
      const { profile } = await api.craft(recipe);
      this.applyProfile(profile);
      this.pokeQuests();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not craft that.';
    }
  }

  /**
   * Enter placement mode. The player then walks around with a ghost igloo
   * under them and confirms with E once the ground is clear.
   */
  startBuilding(style: string) {
    if (this.opts.guest) {
      this.notifyGuest();
      return;
    }
    this.building = { style: IGLOO.styles.includes(style) ? style : IGLOO.styles[0] };
    this.pushChat({
      id: crypto.randomUUID(),
      text: 'Walk to a clear patch of snow and press E to raise your igloo. Esc cancels.',
      system: true,
    });
  }

  cancelBuilding() {
    if (!this.building) return;
    this.building = null;
    this.buildCheck = { ok: false, reason: '' };
  }

  isBuilding() {
    return !!this.building;
  }

  /** Everyone else's igloos — yours does not block your own relocation. */
  private otherIgloos() {
    return [...this.igloos.values()].filter((i) => i.wallet !== this.selfId);
  }

  /** E while placing: try to raise it, and report why not in chat. */
  private async confirmBuild() {
    const error = await this.buildIgloo();
    if (error) this.pushChat({ id: crypto.randomUUID(), text: error, system: true });
  }

  /** Raise an igloo where the player is standing. */
  async buildIgloo(style?: string): Promise<string | null> {
    const chosen = style ?? this.building?.style ?? IGLOO.styles[0];
    const spot = canBuildAt(this.me.x, this.me.y, this.otherIgloos());
    if (!spot.ok) return spot.reason;

    try {
      const { igloo, profile } = await api.buildIgloo(this.me.x, this.me.y, chosen);
      this.applyProfile(profile);
      this.igloos.set(igloo.wallet, igloo);
      announceIgloo(igloo);
      this.building = null;
      this.pushChat({ id: crypto.randomUUID(), text: 'Your igloo is up. Welcome home.', system: true });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not build here.';
    }
  }

  private notifyGuest() {
    if (this.guestCoinNoticeShown) return;
    this.guestCoinNoticeShown = true;
    this.pushChat({
      id: crypto.randomUUID(),
      text: 'Connect a Solana wallet to gather, craft and collect $POG — guests can explore, but not earn.',
      system: true,
    });
  }

  say(text: string) {
    // the broker echoes our own message back, which is what renders the
    // bubble and the log line — no local echo needed
    sendChat({ id: this.selfId, name: this.opts.name, color: this.opts.color, text });
  }

  /** Chat input steals the keyboard; make sure we are not left walking. */
  releaseKeys = () => {
    this.keys.clear();
    this.releaseTouch();
  };

  private pushChat(line: ChatLine) {
    this.opts.onChat(line);
  }

  /**
   * Optimistically hide the coin, then let the API decide. It is the only
   * thing that can credit $POG, and it refuses a coin somebody else already
   * claimed — in which case the coin stays gone for us too, since it really
   * is gone.
   */
  private claim(coinId: number) {
    if (this.claiming.has(coinId)) return;

    // A guest has no wallet to credit, so the coin stays on the ice for
    // someone who does. Say so once rather than silently doing nothing.
    if (this.opts.guest) {
      this.notifyGuest();
      return;
    }

    this.claiming.add(coinId);
    this.taken.add(coinId);

    api
      .claimCoin(coinId, this.me.x, this.me.y)
      .then(({ pog }) => {
        this.me.pog = pog;
        const c = this.coins[coinId];
        if (c) this.pickupFx.push({ x: c.x, y: c.y, t: performance.now(), label: "+1 $POG" });
        announceCoin(coinId);
        this.pokeQuests();
      })
      .catch((err: Error) => {
        // a session that no longer works needs a fresh wallet login
        if (/session/i.test(err.message)) this.opts.onFatal(err.message);
      })
      .finally(() => this.claiming.delete(coinId));
  }

  /* ---------------- input ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
    if (DIR_KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keys.add(e.code);
      e.preventDefault();
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      if (e.repeat) return; // the loop handles held-down swinging
      this.keys.add('KeyE');
      if (this.building) void this.confirmBuild();
      else this.interact();
    } else if (e.code === 'Escape' && this.building) {
      e.preventDefault();
      this.cancelBuilding();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  /**
   * The touch equivalent of holding E. A phone has no keyboard, so without
   * these the whole survival layer — gathering, the stations, confirming a
   * build — is simply unreachable on mobile.
   */
  pressInteract() {
    if (this.keys.has('KeyE')) return; // already held; the loop keeps swinging
    this.keys.add('KeyE');
    if (this.building) void this.confirmBuild();
    else this.interact();
  }

  releaseInteract() {
    this.keys.delete('KeyE');
  }

  /** Holding E keeps swinging at whatever you are standing next to. */
  private autoSwing() {
    if (this.building || !this.keys.has('KeyE')) return;
    if (performance.now() < this.swingUntil) return;
    const node = this.nearNode;
    if (!node || isStation(node.type)) return;
    if (!this.canWork(node)) return;
    this.interact();
  }

  // Only real touch/pen input drives the virtual stick. Capturing the pointer
  // guarantees we still get pointerup if the finger slides off the canvas —
  // without it a missed release leaves the penguin walking forever.
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this.touch = { active: true, baseX: e.clientX, baseY: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.touch.active || e.pointerId !== this.touch.id) return;
    this.touch.x = e.clientX;
    this.touch.y = e.clientY;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.touch.id) return;
    this.releaseTouch();
  };

  private releaseTouch = () => {
    this.touch.active = false;
    this.touch.id = -1;
  };

  private axis(): [number, number, boolean] {
    let ax = 0;
    let ay = 0;
    for (const code of this.keys) {
      const d = DIR_KEYS[code];
      if (d) {
        ax += d[0];
        ay += d[1];
      }
    }
    if (this.touch.active) {
      const dx = this.touch.x - this.touch.baseX;
      const dy = this.touch.y - this.touch.baseY;
      const len = Math.hypot(dx, dy);
      if (len > 14) {
        const k = Math.min(1, len / 70);
        ax += (dx / len) * k;
        ay += (dy / len) * k;
      }
    }
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return [ax, ay, sprint];
  }

  /* ---------------- simulation ---------------- */

  private update(dt: number) {
    const [ax, ay, sprint] = this.axis();
    if (ax || ay) this.moved = true; // no relocating a player who is already walking
    const onIce = isOnIce(this.me.x, this.me.y);

    // A penguin on ice is in its element: noticeably faster than on snow, and
    // it keeps its momentum instead of turning on a dime.
    const base = sprint ? PLAYER.sprintSpeed : PLAYER.speed;
    const speed = onIce ? base * PLAYER.iceSpeedBoost : base;
    const grip = onIce ? PLAYER.iceGrip : PLAYER.snowGrip;

    const targetVx = ax * speed;
    const targetVy = ay * speed * 0.92; // slight vertical damping reads better in 3/4 view
    const k = 1 - Math.exp(-grip * dt);
    this.me.vx += (targetVx - this.me.vx) * k;
    this.me.vy += (targetVy - this.me.vy) * k;

    const moved = Math.hypot(this.me.vx, this.me.vy);
    this.me.moving = moved > 12;

    if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) {
      this.me.dir = Math.abs(ax) > Math.abs(ay) ? (ax < 0 ? 'left' : 'right') : ay < 0 ? 'up' : 'down';
    }

    const next = resolveCollisions(this.me.x + this.me.vx * dt, this.me.y + this.me.vy * dt);
    // kill velocity into a wall so we do not vibrate against it
    if (Math.abs(next.x - (this.me.x + this.me.vx * dt)) > 0.01) this.me.vx *= 0.2;
    if (Math.abs(next.y - (this.me.y + this.me.vy * dt)) > 0.01) this.me.vy *= 0.2;
    this.me.x = next.x;
    this.me.y = next.y;

    // waddle animation
    this.me.anim += dt * (this.me.moving ? 9 * (moved / PLAYER.speed) : 0);
    this.me.frame = Math.floor(this.me.anim) % 4;

    // ice spray: a little crystal kick-up behind a sliding penguin, so the
    // speed boost is something you can see and not just feel
    if (onIce && moved > PLAYER.speed * 0.6) {
      const heading = Math.atan2(this.me.vy, this.me.vx);
      for (let i = 0; i < 2; i++) {
        const spread = heading + Math.PI + (Math.random() - 0.5) * 1.1;
        const kick = 40 + Math.random() * 70;
        this.spray.push({
          x: this.me.x + (Math.random() - 0.5) * 16,
          y: this.me.y + 4,
          vx: Math.cos(spread) * kick,
          vy: Math.sin(spread) * kick * 0.5,
          life: 0.45 + Math.random() * 0.3,
          r: 1.5 + Math.random() * 2.5,
        });
      }
    }
    for (const p of this.spray) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
    }
    if (this.spray.length) this.spray = this.spray.filter((p) => p.life > 0);

    // camera easing
    const camK = 1 - Math.exp(-7 * dt);
    this.cam.x += (this.me.x - this.cam.x) * camK;
    this.cam.y += (this.me.y - this.cam.y) * camK;

    // remote interpolation
    const rk = 1 - Math.exp(-14 * dt);
    for (const r of this.remotes.values()) {
      r.rx += (r.x - r.rx) * rk;
      r.ry += (r.y - r.ry) * rk;
      r.anim += dt * (r.moving ? 9 : 0);
      r.frame = Math.floor(r.anim) % 4;
    }

    // coin pickups — the API decides, this only starts the request
    for (const coin of this.coins) {
      if (this.taken.has(coin.id)) continue;
      if (Math.hypot(this.me.x - coin.x, this.me.y - coin.y) < COIN.pickupRadius) {
        this.claim(coin.id);
      }
    }

    this.nearNode = this.findNearNode();
    this.autoSwing();

    for (const c of this.chips) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vy += 220 * dt; // chips fall back to the snow
      c.life -= dt;
    }
    if (this.chips.length) this.chips = this.chips.filter((c) => c.life > 0);
    if (this.building) this.buildCheck = canBuildAt(this.me.x, this.me.y, this.otherIgloos());

    // position is published on its own timer by publishPresence()
    this.sinceHud += dt;
    if (this.sinceHud >= 0.2) {
      this.sinceHud = 0;
      this.opts.onHud({
        // the broker count can dip during a reconnect, the API count lags a
        // few seconds — whichever is higher is closest to the truth
        online: Math.max(this.remotes.size + 1, this.mqttOnline, this.serverOnline),
        pog: this.me.pog,
        inventory: this.inventory,
        prompt: this.building ? '' : this.promptFor(this.nearNode),
        busy: this.busy,
        building: !!this.building,
        buildOk: this.buildCheck.ok,
        buildReason: this.buildCheck.reason,
        status: presenceConnected() ? 'open' : 'connecting',
        x: Math.round(this.me.x),
        y: Math.round(this.me.y),
        onIce,
      });
    }
  }

  /* ---------------- rendering ---------------- */

  private resize = () => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, rect.width);
    this.h = Math.max(240, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.initSnow();
  };

  private initSnow() {
    const count = Math.round((this.w * this.h) / 9000) || 90;
    this.snow = Array.from({ length: Math.min(220, count) }, () => ({
      x: Math.random() * (this.w || 800),
      y: Math.random() * (this.h || 600),
      r: 1 + Math.random() * 2.6,
      s: 18 + Math.random() * 46,
      d: Math.random() * Math.PI * 2,
    }));
  }

  private sx(wx: number) {
    return (wx - this.cam.x) * ZOOM + this.w / 2;
  }

  private sy(wy: number) {
    return (wy - this.cam.y) * Y_SCALE * ZOOM + this.h / 2;
  }

  private drawGround() {
    const ctx = this.ctx;
    const halfW = this.w / (2 * ZOOM);
    const halfH = this.h / (2 * ZOOM * Y_SCALE);
    const x0 = Math.floor((this.cam.x - halfW) / CHUNK);
    const x1 = Math.floor((this.cam.x + halfW) / CHUNK);
    const y0 = Math.floor((this.cam.y - halfH) / CHUNK);
    const y1 = Math.floor((this.cam.y + halfH) / CHUNK);

    const cw = CHUNK * ZOOM + 1;
    const ch = CHUNK * Y_SCALE * ZOOM + 1;

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const ox = cx * CHUNK;
        const oy = cy * CHUNK;
        if (ox < -CHUNK || oy < -CHUNK || ox > WORLD.width || oy > WORLD.height) continue;
        ctx.drawImage(getGroundChunk(cx, cy), this.sx(ox), this.sy(oy), cw, ch);
      }
    }
  }

  private drawNameTag(x: number, y: number, name: string, color: string, isSelf: boolean, guest: boolean) {
    const ctx = this.ctx;
    ctx.font = `700 13px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = guest ? name + ' · guest' : name;
    const w = ctx.measureText(label).width + 22;

    ctx.fillStyle = isSelf ? 'rgba(13,43,58,0.92)' : 'rgba(13,27,38,0.72)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
    ctx.fill();
    if (isSelf) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // a hollow dot marks a wallet-less penguin, a filled one a holder
    ctx.beginPath();
    ctx.arc(x - w / 2 + 10, y, 3.5, 0, Math.PI * 2);
    if (guest) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.fillStyle = guest ? 'rgba(238,246,251,0.7)' : '#eef6fb';
    ctx.fillText(label, x + 5, y + 0.5);
  }

  private drawBubble(x: number, y: number, text: string) {
    const ctx = this.ctx;
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = Math.min(230, ctx.measureText(text).width + 24);
    const h = 26;

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h, w, h, 12);
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x, y + 7);
    ctx.lineTo(x + 6, y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#12232e';
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - w / 2, y - h, w, h);
    ctx.clip();
    ctx.fillText(text, x, y - h / 2);
    ctx.restore();
  }

  private drawWorld() {
    const ctx = this.ctx;
    const now = performance.now();
    const marginX = 200;
    const marginTop = 260;
    const halfW = this.w / (2 * ZOOM);
    const halfH = this.h / (2 * ZOOM * Y_SCALE);
    const minX = this.cam.x - halfW - marginX;
    const maxX = this.cam.x + halfW + marginX;
    const minY = this.cam.y - halfH - marginTop;
    const maxY = this.cam.y + halfH + 120;

    type Item = { y: number; draw: () => void };
    const items: Item[] = [];

    const wallClock = Date.now();
    const isDepleted = (id: string) => (this.depleted.get(id) ?? 0) > wallClock;

    this.props.forEach((p, i) => {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return;
      const nodeId = this.treeNodeByProp.get(i);
      if (nodeId && isDepleted(nodeId)) {
        items.push({ y: p.y, draw: () => drawStump(ctx, this.sx(p.x), this.sy(p.y), ZOOM, p.scale) });
      } else {
        const wobble = nodeId ? this.shakeOffset(nodeId, now) : 0;
        items.push({ y: p.y, draw: () => drawProp(ctx, p, this.sx(p.x) + wobble, this.sy(p.y), ZOOM, now) });
      }
    });

    for (const n of this.nodes) {
      if (n.type === 'tree') continue; // drawn as part of the pine above
      if (n.x < minX || n.x > maxX || n.y < minY || n.y > maxY) continue;
      const out = isDepleted(n.id);
      const wobble = this.shakeOffset(n.id, now);
      items.push({ y: n.y, draw: () => drawNode(ctx, n, this.sx(n.x) + wobble, this.sy(n.y), ZOOM, now, out) });
    }

    if (this.building) {
      const ok = this.buildCheck.ok;
      const style = this.building.style;
      items.push({
        y: this.me.y - 1,
        draw: () => drawIglooGhost(ctx, this.sx(this.me.x), this.sy(this.me.y), ZOOM, style, ok),
      });
    }

    for (const igloo of this.igloos.values()) {
      if (igloo.x < minX || igloo.x > maxX || igloo.y < minY || igloo.y > maxY) continue;
      items.push({
        y: igloo.y,
        draw: () => drawIgloo(ctx, this.sx(igloo.x), this.sy(igloo.y), ZOOM, igloo.style, igloo.owner, now),
      });
    }

    for (const c of this.coins) {
      if (this.taken.has(c.id)) continue;
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      items.push({ y: c.y, draw: () => drawCoin(ctx, this.sx(c.x), this.sy(c.y), now, ZOOM) });
    }

    const drawActor = (
      wx: number,
      wy: number,
      dir: Dir,
      frame: number,
      moving: boolean,
      color: string,
      name: string,
      id: string,
      isSelf: boolean,
      guest: boolean
    ) => {
      const x = this.sx(wx);
      const y = this.sy(wy);
      ctx.fillStyle = 'rgba(56,92,120,0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y, 20 * ZOOM, 8 * ZOOM, 0, 0, Math.PI * 2);
      ctx.fill();
      blitPenguin(ctx, color, dir, frame, moving, x, y, PENGUIN_WORLD_HEIGHT * ZOOM, isSelf ? this.hat : null);
      this.drawNameTag(x, y - PENGUIN_WORLD_HEIGHT * ZOOM - 14, name, color, isSelf, guest);
      const bubble = this.bubbles.get(id);
      if (bubble && bubble.until > now) {
        this.drawBubble(x, y - PENGUIN_WORLD_HEIGHT * ZOOM - 34, bubble.text);
      }
    };

    for (const r of this.remotes.values()) {
      if (r.rx < minX || r.rx > maxX || r.ry < minY || r.ry > maxY) continue;
      items.push({
        y: r.ry,
        draw: () => drawActor(r.rx, r.ry, r.dir, r.frame, r.moving, r.color, r.name, r.id, false, r.guest),
      });
    }

    items.push({
      y: this.me.y,
      draw: () =>
        drawActor(
          this.me.x,
          this.me.y,
          this.me.dir,
          this.me.frame,
          this.me.moving,
          this.opts.color,
          this.opts.name,
          this.selfId,
          true,
          this.opts.guest
        ),
    });

    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    // wood splinters and ice shards from the last swing
    if (this.chips.length) {
      ctx.save();
      for (const c of this.chips) {
        ctx.globalAlpha = Math.min(1, c.life * 3);
        ctx.fillStyle = c.color;
        ctx.fillRect(this.sx(c.x) - 2, this.sy(c.y) - 2, 4 * ZOOM, 4 * ZOOM);
      }
      ctx.restore();
    }

    // how far through the node we are
    for (const [id, progress] of this.hits) {
      if (now - progress.at > 8000) {
        this.hits.delete(id);
        continue;
      }
      const node = this.nodes.find((n) => n.id === id);
      if (!node) continue;
      this.drawHitGauge(this.sx(node.x), this.sy(node.y) - 64 * ZOOM, progress.hits, progress.needed);
    }

    // ice spray sits on the ground, under the name tags and coins
    if (this.spray.length) {
      ctx.save();
      for (const p of this.spray) {
        ctx.globalAlpha = Math.min(1, p.life * 2.2) * 0.75;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.sx(p.x), this.sy(p.y), p.r * ZOOM, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // pickup sparkles
    this.pickupFx = this.pickupFx.filter((fx) => now - fx.t < 700);
    for (const fx of this.pickupFx) {
      const t = (now - fx.t) / 700;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = '#ffd44d';
      ctx.font = `800 ${18 + t * 8}px "Baloo 2", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(fx.label, this.sx(fx.x), this.sy(fx.y) - 40 - t * 34);
      ctx.restore();
    }
  }

  /** Visual feedback for the touch stick, so mobile players can see the input. */
  private drawTouchStick() {
    if (!this.touch.active) return;
    const ctx = this.ctx;
    const dx = this.touch.x - this.touch.baseX;
    const dy = this.touch.y - this.touch.baseY;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(1, len / 70);
    const kx = len > 0 ? this.touch.baseX + (dx / len) * clamped * 46 : this.touch.baseX;
    const ky = len > 0 ? this.touch.baseY + (dy / len) * clamped * 46 : this.touch.baseY;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.fillStyle = 'rgba(13,43,58,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.touch.baseX, this.touch.baseY, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,92,23,0.9)';
    ctx.beginPath();
    ctx.arc(kx, ky, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawWeather(dt: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of this.snow) {
      f.d += dt * 1.5;
      f.y += f.s * dt;
      f.x += Math.sin(f.d) * 14 * dt + 16 * dt;
      if (f.y > this.h + 6) {
        f.y = -6;
        f.x = Math.random() * this.w;
      }
      if (f.x > this.w + 6) f.x = -6;
      ctx.globalAlpha = 0.35 + (f.r / 3.6) * 0.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // cold vignette
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h / 2,
      Math.min(this.w, this.h) * 0.42,
      this.w / 2,
      this.h / 2,
      Math.max(this.w, this.h) * 0.78
    );
    g.addColorStop(0, 'rgba(10,26,36,0)');
    g.addColorStop(1, 'rgba(10,26,36,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawMinimap() {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const size = ctx.canvas.width;
    const k = size / WORLD.width;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#e8f2fa';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#a9d6ec';
    for (const l of getLakes()) {
      ctx.beginPath();
      ctx.ellipse(l.x * k, l.y * k, l.rx * k, l.ry * k, l.rot, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(WORLD.spawn.x * k, WORLD.spawn.y * k, WORLD.spawnRadius * k, 0, Math.PI * 2);
    ctx.stroke();

    for (const r of this.remotes.values()) {
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.rx * k, r.ry * k, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ff5c17';
    ctx.strokeStyle = '#0d2b3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.me.x * k, this.me.y * k, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    this.update(dt);

    const ctx = this.ctx;
    ctx.fillStyle = '#cfe3f2';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawGround();
    this.drawWorld();
    this.drawWeather(dt);
    this.drawTouchStick();
    this.drawMinimap();

    this.raf = requestAnimationFrame(this.loop);
  };
}
