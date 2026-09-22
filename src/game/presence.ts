/**
 * Realtime multiplayer with no server of our own.
 *
 * Every client connects to a public MQTT broker over WebSockets and publishes
 * its penguin's position on a shared topic a few times a second, while
 * subscribing to everyone else's. There is no authoritative game server to
 * host, which is what lets the whole thing run as a static site on Vercel.
 *
 * A player is "present" only while their messages keep arriving: each entry
 * carries a timestamp and is dropped after PRESENCE_TTL, so a closed tab or a
 * dead connection fades out on its own without any goodbye message.
 *
 * Anything worth cheating for — $POG balances, usernames, coin ownership —
 * is NOT trusted from this channel. That goes through the API in `api/`.
 */

import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';

// HiveMQ's public broker: no account, no keys, WebSocket + TLS.
// Swap in a dedicated broker (HiveMQ Cloud / EMQX Cloud free tier) if the
// public one ever starts dropping this topic tree.
const BROKER = import.meta.env.VITE_MQTT_URL || 'wss://broker.hivemq.com:8884/mqtt';
const NS = 'pogfrozenworld/v1';

const WORLD_TOPIC = `${NS}/world`;
const CHAT_TOPIC = `${NS}/chat`;
const COIN_TOPIC = `${NS}/coins`;
const ONLINE_TOPIC = `${NS}/online`;

const PRESENCE_TTL = 4000; // drop a penguin not heard from in 4s
const PRESENCE_HZ = 140; // publish every 140ms (~7×/sec)
const ONLINE_TTL = 28000;

let client: MqttClient | null = null;

function getClient(): MqttClient {
  if (client) return client;
  client = mqtt.connect(BROKER, {
    clientId: 'pog-' + Math.random().toString(36).slice(2, 10),
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    keepalive: 20,
    resubscribe: true,
    clean: true,
  });

  // Background tabs suspend the socket. Nudge it awake the moment we are
  // looked at again, so presence resumes without a page refresh.
  if (typeof document !== 'undefined') {
    const wake = () => {
      if (document.hidden || !client) return;
      try {
        if (!client.connected) client.reconnect();
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
  }
  return client;
}

export const presenceConnected = () => !!client?.connected;

/** Run `fn` now if connected, otherwise once the connection opens. */
function whenReady(c: MqttClient, fn: () => void) {
  if (c.connected) fn();
  else c.once('connect', fn);
}

/** Subscribe, and re-subscribe after every reconnect. Returns a detach fn. */
function listen(topicFilter: string, onMsg: (topic: string, payload: Uint8Array) => void): () => void {
  const c = getClient();
  const sub = () => c.subscribe(topicFilter, { qos: 0 });
  c.on('message', onMsg);
  c.on('connect', sub);
  if (c.connected) sub();
  return () => {
    c.removeListener('message', onMsg);
    c.removeListener('connect', sub);
    try {
      c.unsubscribe(topicFilter);
    } catch {
      /* ignore */
    }
  };
}

const publish = (topic: string, data: unknown, retain = false) => {
  const c = getClient();
  const send = () => {
    try {
      c.publish(topic, JSON.stringify(data), { qos: 0, retain });
    } catch {
      /* ignore */
    }
  };
  whenReady(c, send);
};

/* ------------------------------------------------------------------ *
 * Penguin positions
 * ------------------------------------------------------------------ */

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface PresenceState {
  id: string;
  name: string;
  color: string;
  /** wallet-less players are marked so nobody mistakes them for a holder */
  guest: boolean;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /**
   * The wallet whose igloo this penguin has stepped into, if any. Players
   * indoors are not drawn on the snow — without this they would appear to
   * be standing on their own doorstep the whole time they are inside.
   */
  inside?: string;
}

export interface Presence extends PresenceState {
  ts: number;
}

/** Publish this penguin ~7×/sec until the returned stop() is called. */
export function publishPresence(getState: () => PresenceState): () => void {
  const c = getClient();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastId = '';

  const tick = () => {
    const s = getState();
    lastId = s.id;
    // rounded coordinates keep each message small
    publish(`${WORLD_TOPIC}/${s.id}`, {
      ...s,
      x: Math.round(s.x),
      y: Math.round(s.y),
      ts: Date.now(),
    });
  };

  whenReady(c, () => {
    tick();
    timer = setInterval(tick, PRESENCE_HZ);
  });

  return () => {
    if (timer) clearInterval(timer);
    if (lastId) publish(`${WORLD_TOPIC}/${lastId}`, { id: lastId, left: true, ts: Date.now() });
  };
}

/** Live list of everyone else's penguins. */
export function subscribePresence(selfId: string, cb: (players: Presence[]) => void): () => void {
  const players = new Map<string, Presence>();

  const emit = () => {
    const now = Date.now();
    cb([...players.values()].filter((p) => p.id !== selfId && now - p.ts < PRESENCE_TTL));
  };

  const detach = listen(`${WORLD_TOPIC}/#`, (topic, payload) => {
    if (!topic.startsWith(WORLD_TOPIC + '/')) return;
    try {
      const d = JSON.parse(payload.toString());
      if (d.left) players.delete(d.id);
      else if (d.id && Number.isFinite(d.x) && Number.isFinite(d.y)) {
        players.set(d.id, {
          id: String(d.id),
          name: String(d.name || 'Penguin').slice(0, 16),
          color: typeof d.color === 'string' ? d.color : '#ff6b2c',
          x: d.x,
          y: d.y,
          dir: ['up', 'down', 'left', 'right'].includes(d.dir) ? d.dir : 'down',
          moving: !!d.moving,
          guest: !!d.guest,
          ts: Math.min(Date.now(), Number(d.ts) || Date.now()),
        });
      }
    } catch {
      /* ignore malformed */
    }
    emit();
  });

  const prune = setInterval(emit, 1200);
  return () => {
    clearInterval(prune);
    detach();
  };
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export interface ChatMsg {
  id: string;
  name: string;
  color: string;
  text: string;
  ts: number;
}

export function sendChat(msg: Omit<ChatMsg, 'ts'>) {
  publish(CHAT_TOPIC, { ...msg, text: msg.text.slice(0, 140), ts: Date.now() });
}

/** The broker echoes your own messages back, so do not also add them locally. */
export function subscribeChat(cb: (m: ChatMsg) => void): () => void {
  return listen(CHAT_TOPIC, (topic, payload) => {
    if (topic !== CHAT_TOPIC) return;
    try {
      const m = JSON.parse(payload.toString());
      if (typeof m?.text !== 'string') return;
      cb({
        id: String(m.id || ''),
        name: String(m.name || 'Penguin').slice(0, 16),
        color: typeof m.color === 'string' ? m.color : '#ff6b2c',
        text: String(m.text).slice(0, 140),
        ts: Number(m.ts) || Date.now(),
      });
    } catch {
      /* ignore */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Coin pickups
 *
 * Purely cosmetic sync so a coin vanishes on everyone's screen at once.
 * The actual credit is granted by the API, which is the only thing that
 * decides who really got it.
 * ------------------------------------------------------------------ */

export function announceCoin(id: number) {
  publish(COIN_TOPIC, { id, ts: Date.now() });
}

export function subscribeCoins(cb: (id: number) => void): () => void {
  return listen(COIN_TOPIC, (topic, payload) => {
    if (topic !== COIN_TOPIC) return;
    try {
      const d = JSON.parse(payload.toString());
      if (Number.isInteger(d?.id)) cb(d.id);
    } catch {
      /* ignore */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Resource nodes and igloos
 *
 * Cosmetic sync again: everyone sees a tree fall or an igloo go up at
 * once, but the API is what actually decided it happened.
 * ------------------------------------------------------------------ */

const NODE_TOPIC = `${NS}/nodes`;
const IGLOO_TOPIC = `${NS}/igloos`;

export function announceNode(id: string, respawnAt: number) {
  publish(NODE_TOPIC, { id, respawnAt, ts: Date.now() });
}

export function subscribeNodes(cb: (id: string, respawnAt: number) => void): () => void {
  return listen(NODE_TOPIC, (topic, payload) => {
    if (topic !== NODE_TOPIC) return;
    try {
      const d = JSON.parse(payload.toString());
      if (typeof d?.id === 'string') cb(d.id, Number(d.respawnAt) || Date.now() + 60000);
    } catch {
      /* ignore */
    }
  });
}

export interface IglooMsg {
  wallet: string;
  owner: string;
  x: number;
  y: number;
  style: string;
  builtAt: number;
  /** what is standing inside, in room coordinates */
  furniture?: Array<{ id: string; x: number; y: number }>;
  lastYield?: number;
}

export function announceIgloo(igloo: IglooMsg) {
  publish(IGLOO_TOPIC, igloo);
}

export function subscribeIgloos(cb: (igloo: IglooMsg) => void): () => void {
  return listen(IGLOO_TOPIC, (topic, payload) => {
    if (topic !== IGLOO_TOPIC) return;
    try {
      const d = JSON.parse(payload.toString());
      if (typeof d?.wallet === 'string' && Number.isFinite(d.x) && Number.isFinite(d.y)) {
        cb({
          wallet: String(d.wallet).slice(0, 64),
          owner: String(d.owner || 'Someone').slice(0, 16),
          x: d.x,
          y: d.y,
          style: String(d.style || 'classic').slice(0, 16),
          builtAt: Number(d.builtAt) || Date.now(),
        });
      }
    } catch {
      /* ignore */
    }
  });
}

/* ------------------------------------------------------------------ *
 * Site-wide online counter
 * ------------------------------------------------------------------ */

/**
 * Heartbeat on a shared topic and report how many unique clients are live.
 * Messages are RETAINED so a client that just subscribed immediately learns
 * about everyone instead of waiting a full heartbeat round; stale retained
 * entries are filtered out by their own timestamp.
 */
export function trackOnline(selfId: string, cb: (count: number) => void): () => void {
  const seen = new Map<string, number>([[selfId, Date.now()]]);

  const recount = () => {
    const now = Date.now();
    for (const [id, ts] of seen) if (now - ts > ONLINE_TTL) seen.delete(id);
    seen.set(selfId, Date.now());
    cb(seen.size);
  };

  const beat = () => publish(`${ONLINE_TOPIC}/${selfId}`, { id: selfId, ts: Date.now() }, true);

  const detach = listen(`${ONLINE_TOPIC}/#`, (topic, payload) => {
    if (!topic.startsWith(ONLINE_TOPIC + '/')) return;
    try {
      const d = JSON.parse(payload.toString());
      // trust the message's own timestamp: a retained entry from someone who
      // left uncleanly carries an old one and correctly ages out
      if (d.left) seen.delete(d.id);
      else if (d.id) seen.set(d.id, Math.min(Date.now(), Number(d.ts) || Date.now()));
    } catch {
      /* an empty retained payload is a clear — ignore */
    }
  });

  beat();
  recount();
  const timer = setInterval(() => {
    beat();
    recount();
  }, 3000);

  return () => {
    clearInterval(timer);
    detach();
    publish(`${ONLINE_TOPIC}/${selfId}`, { id: selfId, left: true, ts: Date.now() });
    // clear our retained entry so it does not linger for future joiners
    try {
      getClient().publish(`${ONLINE_TOPIC}/${selfId}`, '', { qos: 0, retain: true });
    } catch {
      /* ignore */
    }
  };
}
