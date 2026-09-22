/**
 * Key-value access for the serverless API.
 *
 * In production this is Upstash Redis over HTTP — the one database shape that
 * works from Vercel functions, which are short-lived and have no disk.
 * Credentials come from the Vercel ↔ Upstash integration.
 *
 * Without credentials it falls back to an in-process map so `npm run dev`
 * works offline. That fallback is single-process only: on Vercel each
 * invocation may be a fresh instance, so a deploy without Redis would appear
 * to forget everything. `kvEnabled()` reports which one is live.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = () =>
  process.env.POG_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  '';

const token = () =>
  process.env.POG_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  '';

export const kvEnabled = () => !!url() && !!token();

export interface Kv {
  get<T = any>(key: string): Promise<T | null>;
  mget<T = any>(keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: any, opts?: { ex?: number }): Promise<void>;
  /** true when the key did not exist and was created */
  setnx(key: string, value: any, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /** add to a counter that never expires; returns the new total */
  incrBy(key: string, amount: number): Promise<number>;
  hget<T = any>(key: string, field: string): Promise<T | null>;
  hgetall<T = any>(key: string): Promise<Record<string, T> | null>;
  hset(key: string, field: string, value: any): Promise<void>;
  /** true when the field did not exist and was created */
  hsetnx(key: string, field: string, value: any): Promise<boolean>;
  hdel(key: string, field: string): Promise<void>;
  /** append to a capped log, newest last */
  rpushCapped(key: string, value: any, max: number): Promise<void>;
  lrange<T = any>(key: string, start: number, stop: number): Promise<T[]>;
  /**
   * Take an exclusive lock, or return null if somebody holds it. The lock
   * expires on its own so a crashed function cannot wedge a wallet, and the
   * release checks the token so a slow holder cannot free the next one's.
   */
  lock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
  zadd(key: string, score: number, member: string): Promise<void>;
  /** true when the member was newly added (not already present) */
  zaddnx(key: string, score: number, member: string): Promise<boolean>;
  zremRangeByScore(key: string, min: number, max: number): Promise<void>;
  zrangeByScore(key: string, min: number, max: number): Promise<string[]>;
  zcard(key: string): Promise<number>;
  /** highest scores first */
  ztop(key: string, limit: number): Promise<Array<{ member: string; score: number }>>;
}

/* ------------------------------------------------------------------ *
 * Upstash
 * ------------------------------------------------------------------ */

let upstash: Kv | null = null;

async function redisKv(): Promise<Kv> {
  if (upstash) return upstash;
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url: url(), token: token() });

  upstash = {
    get: (key) => r.get(key) as any,
    mget: (keys) => (keys.length ? (r.mget(...(keys as [string])) as any) : Promise.resolve([])),
    set: async (key, value, opts) => {
      await (opts?.ex ? r.set(key, value, { ex: opts.ex }) : r.set(key, value));
    },
    setnx: async (key, value, ttl) => (await r.set(key, value, { nx: true, ex: ttl })) !== null,
    del: async (key) => {
      await r.del(key);
    },
    incrWithTtl: async (key, ttl) => {
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, ttl);
      return n;
    },
    incrBy: (key, amount) => r.incrby(key, Math.trunc(amount)),
    hget: (key, field) => r.hget(key, field) as any,
    hgetall: (key) => r.hgetall(key) as any,
    hset: async (key, field, value) => {
      await r.hset(key, { [field]: value });
    },
    hsetnx: async (key, field, value) => Number(await r.hsetnx(key, field, value)) === 1,
    hdel: async (key, field) => {
      await r.hdel(key, field);
    },
    rpushCapped: async (key, value, max) => {
      await r.rpush(key, value);
      await r.ltrim(key, -max, -1);
    },
    lrange: (key, start, stop) => r.lrange(key, start, stop) as any,
    lock: async (key, ttlMs) => {
      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const got = await r.set(key, token, { nx: true, px: ttlMs });
      if (got === null) return null;
      return async () => {
        // compare-and-delete in one round trip, so an expired lock that
        // somebody else re-took is never released out from under them
        await r.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
          [key],
          [token]
        );
      };
    },
    zadd: async (key, score, member) => {
      await r.zadd(key, { score, member });
    },
    zaddnx: async (key, score, member) => {
      const added = await r.zadd(key, { nx: true }, { score, member });
      return Number(added) > 0;
    },
    zremRangeByScore: async (key, min, max) => {
      await r.zremrangebyscore(key, min, max);
    },
    zrangeByScore: async (key, min, max) =>
      (await r.zrange(key, min, max, { byScore: true })) as string[],
    zcard: async (key) => Number(await r.zcard(key)) || 0,
    ztop: async (key, limit) => {
      const flat = (await r.zrange(key, 0, limit - 1, { rev: true, withScores: true })) as any[];
      const out: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < flat.length; i += 2) {
        out.push({ member: String(flat[i]), score: Number(flat[i + 1]) || 0 });
      }
      return out;
    },
  };
  return upstash;
}

/* ------------------------------------------------------------------ *
 * In-process fallback (local dev only)
 * ------------------------------------------------------------------ */

interface Entry {
  value: any;
  exp: number; // 0 = no expiry
}

const mem = new Map<string, Entry>();
const zsets = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, any>>();

const lists = new Map<string, any[]>();

const alive = (e: Entry | undefined): e is Entry => !!e && (e.exp === 0 || e.exp > Date.now());

/**
 * Every in-memory call yields to the event loop for a moment. Without this
 * a whole request runs to completion inside one macrotask and two
 * "concurrent" requests never interleave — which would hide exactly the
 * races the wallet lock exists to prevent, and make `cheatcheck` pass
 * locally for code that loses updates against real Redis.
 */
const tick = () => new Promise<void>((r) => setTimeout(r, 1));

const memoryKv: Kv = {
  async get(key) {
    await tick();
    const e = mem.get(key);
    if (!alive(e)) {
      mem.delete(key);
      return null;
    }
    return e.value;
  },
  async mget(keys) {
    return Promise.all(keys.map((k) => memoryKv.get(k)));
  },
  async set(key, value, opts) {
    await tick();
    mem.set(key, { value, exp: opts?.ex ? Date.now() + opts.ex * 1000 : 0 });
  },
  async setnx(key, value, ttl) {
    await tick();
    if (alive(mem.get(key))) return false;
    mem.set(key, { value, exp: Date.now() + ttl * 1000 });
    return true;
  },
  async del(key) {
    mem.delete(key);
  },
  async incrWithTtl(key, ttl) {
    const e = mem.get(key);
    const n = (alive(e) ? Number(e.value) || 0 : 0) + 1;
    mem.set(key, { value: n, exp: alive(e) ? e.exp : Date.now() + ttl * 1000 });
    return n;
  },
  async incrBy(key, amount) {
    const e = mem.get(key);
    const n = (alive(e) ? Number(e.value) || 0 : 0) + Math.trunc(amount);
    mem.set(key, { value: n, exp: 0 });
    return n;
  },
  async hget(key, field) {
    return hashes.get(key)?.get(field) ?? null;
  },
  async hgetall(key) {
    const h = hashes.get(key);
    return h ? Object.fromEntries(h) : null;
  },
  async hset(key, field, value) {
    await tick();
    if (!hashes.has(key)) hashes.set(key, new Map());
    hashes.get(key)!.set(field, value);
  },
  async hsetnx(key, field, value) {
    await tick();
    if (!hashes.has(key)) hashes.set(key, new Map());
    const h = hashes.get(key)!;
    if (h.has(field)) return false;
    h.set(field, value);
    return true;
  },
  async hdel(key, field) {
    hashes.get(key)?.delete(field);
  },
  async rpushCapped(key, value, max) {
    if (!lists.has(key)) lists.set(key, []);
    const l = lists.get(key)!;
    l.push(value);
    if (l.length > max) l.splice(0, l.length - max);
  },
  async lrange(key, start, stop) {
    const l = lists.get(key) ?? [];
    const end = stop < 0 ? l.length + stop + 1 : stop + 1;
    return l.slice(start < 0 ? l.length + start : start, end);
  },
  async lock(key, ttlMs) {
    await tick();
    if (alive(mem.get(key))) return null;
    const token = Math.random().toString(36).slice(2);
    mem.set(key, { value: token, exp: Date.now() + ttlMs });
    return async () => {
      const e = mem.get(key);
      if (e && e.value === token) mem.delete(key);
    };
  },
  async zadd(key, score, member) {
    if (!zsets.has(key)) zsets.set(key, new Map());
    zsets.get(key)!.set(member, score);
  },
  async zaddnx(key, score, member) {
    if (!zsets.has(key)) zsets.set(key, new Map());
    const z = zsets.get(key)!;
    if (z.has(member)) return false;
    z.set(member, score);
    return true;
  },
  async zremRangeByScore(key, min, max) {
    const z = zsets.get(key);
    if (!z) return;
    for (const [m, s] of z) if (s >= min && s <= max) z.delete(m);
  },
  async zrangeByScore(key, min, max) {
    const z = zsets.get(key);
    if (!z) return [];
    return [...z.entries()].filter(([, s]) => s >= min && s <= max).map(([m]) => m);
  },
  async zcard(key) {
    return zsets.get(key)?.size ?? 0;
  },
  async ztop(key, limit) {
    const z = zsets.get(key);
    if (!z) return [];
    return [...z.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([member, score]) => ({ member, score }));
  },
};

export async function kv(): Promise<Kv> {
  return kvEnabled() ? redisKv() : memoryKv;
}
