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
  hdel(key: string, field: string): Promise<void>;
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
    hdel: async (key, field) => {
      await r.hdel(key, field);
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

const alive = (e: Entry | undefined): e is Entry => !!e && (e.exp === 0 || e.exp > Date.now());

const memoryKv: Kv = {
  async get(key) {
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
    mem.set(key, { value, exp: opts?.ex ? Date.now() + opts.ex * 1000 : 0 });
  },
  async setnx(key, value, ttl) {
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
    if (!hashes.has(key)) hashes.set(key, new Map());
    hashes.get(key)!.set(field, value);
  },
  async hdel(key, field) {
    hashes.get(key)?.delete(field);
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
