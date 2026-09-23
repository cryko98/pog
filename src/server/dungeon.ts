/**
 * The bear caves, server side: one run at a time per wallet, a stamped
 * input log, a seed the client learns only when the run starts, and the
 * settlement — gold into the pack if you walked out, the pack emptied if
 * you did not.
 *
 * Nothing about kills, gold or hearts is taken from a request. The run is
 * replayed from the log (`shared/dungeon.js`) whenever it is read, and
 * settled exactly once, under the wallet lock.
 */

import { kv } from './kv.js';
import { withWallet } from './lock.js';
import { K, getProfile, putProfile, trackMovement, type Profile } from './game.js';
import { GATHER, getNode } from '../../shared/world.js';
import { CAVE, runHardEnd, seedOf, simulateRun, validRunInput } from '../../shared/dungeon.js';

export interface RunInput {
  seq: number;
  t: number;
  type: 'move' | 'jump' | 'throw' | 'leave';
  dir?: number;
  n?: string;
}

export interface Run {
  id: string;
  wallet: string;
  seed: number;
  startAt: number;
  /** filled in once the run has been replayed to an end and settled */
  settled?: { why: 'dead' | 'left' | 'closed'; gold: number; kills: number; wave: number; at: number; lost?: Record<string, number> };
}

const KEY = {
  run: (id: string) => `pog:cave:${id}`,
  of: (wallet: string) => `pog:cave:of:${wallet}`,
  inputs: (id: string) => `pog:cavelog:${id}`,
  rate: (id: string, sec: number) => `pog:caverate:${id}:${sec}`,
  cooldown: (wallet: string) => `pog:cavecool:${wallet}`,
};

const RUN_TTL = 24 * 3600;
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
const load = async (id: string) => (await kv()).get<Run>(KEY.run(id));
const save = async (r: Run) => (await kv()).set(KEY.run(r.id), r, { ex: RUN_TTL });
const inputLog = async (id: string) => (await kv()).lrange<RunInput>(KEY.inputs(id), 0, -1);

/** The cave mouth: you have to be standing at it to go in. */
async function atCave(wallet: string, x: unknown, y: unknown): Promise<string | null> {
  const cave = getNode('station-cave');
  const px = Number(x);
  const py = Number(y);
  if (!cave) return 'The cave is not there.';
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 'Where are you?';
  if (Math.hypot(px - cave.x, py - cave.y) > GATHER.range * 2.2) return 'Walk up to the cave mouth first.';
  return trackMovement(wallet, px, py);
}

/* ------------------------------------------------------------------ *
 * Going in
 * ------------------------------------------------------------------ */

export async function enterCave(wallet: string, x: unknown, y: unknown): Promise<{ run?: Run; error?: string }> {
  const store = await kv();
  const current = await store.get<string>(KEY.of(wallet));
  if (current) {
    const r = await load(current);
    if (r && !r.settled && Date.now() < runHardEnd(r.startAt)) return { run: r };
  }
  if (await store.get(KEY.cooldown(wallet))) return { error: 'Catch your breath — the cave takes a moment to settle.' };
  const where = await atCave(wallet, x, y);
  if (where) return { error: where };

  return withWallet(wallet, async () => {
    const profile = await getProfile(wallet);
    if (!profile) return { error: 'Pick a username first.' };
    const id = newId();
    const run: Run = { id, wallet, seed: seedOf(id + ':' + wallet), startAt: Date.now() + 3000 };
    await save(run);
    await store.set(KEY.of(wallet), id, { ex: RUN_TTL });
    return { run };
  });
}

/* ------------------------------------------------------------------ *
 * The log
 * ------------------------------------------------------------------ */

export async function caveInput(wallet: string, id: unknown, raw: unknown): Promise<{ seq?: number; t?: number; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such run.' };
  if (!validRunInput(raw)) return { error: 'That is not a move.' };
  const run = await load(id);
  if (!run || run.wallet !== wallet) return { error: 'Not your run.' };
  if (run.settled) return { error: 'That run is over.' };
  const now = Date.now();
  if (now < run.startAt) return { error: 'Not yet.' };
  if (now > runHardEnd(run.startAt)) return { error: 'That run is over.' };

  const store = await kv();
  const burst = await store.incrWithTtl(KEY.rate(id, Math.floor(now / 1000)), 3);
  if (burst > CAVE.inputsPerSec) return { error: 'Slow down.' };

  const r = raw as { type: RunInput['type']; dir?: number; n?: unknown };
  const input: Omit<RunInput, 'seq'> = { t: now, type: r.type };
  if (r.type === 'move') input.dir = r.dir;
  if (typeof r.n === 'string' && r.n) input.n = r.n.slice(0, 12);
  const seq = await store.rpushLen(KEY.inputs(id), input, RUN_TTL);
  return { seq, t: now };
}

export async function caveInputs(wallet: string, id: unknown, since: unknown): Promise<{ inputs?: RunInput[]; serverNow?: number; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such run.' };
  const run = await load(id);
  if (!run || run.wallet !== wallet) return { error: 'Not your run.' };
  const from = Math.max(0, Math.floor(Number(since) || 0));
  const rows = await (await kv()).lrange<Omit<RunInput, 'seq'>>(KEY.inputs(id), from, -1);
  return { inputs: rows.map((r, i) => ({ ...r, seq: from + i + 1 })), serverNow: Date.now() };
}

/* ------------------------------------------------------------------ *
 * Reading it, and settling it
 * ------------------------------------------------------------------ */

export function viewOf(run: Run) {
  return {
    id: run.id,
    seed: run.seed,
    startAt: run.startAt,
    serverNow: Date.now(),
    settled: run.settled ?? null,
    rules: CAVE,
  };
}

export type RunView = ReturnType<typeof viewOf>;

/**
 * The run as it stands. If the replay says it has ended, settle it now —
 * once — so the gold (or the loss) lands the moment it is read.
 */
export async function caveState(wallet: string, id?: unknown): Promise<{ run: RunView | null; profile?: Profile }> {
  const store = await kv();
  const target = typeof id === 'string' && id ? id : await store.get<string>(KEY.of(wallet));
  if (!target) return { run: null };
  const run = await load(target);
  if (!run || run.wallet !== wallet) return { run: null };
  if (run.settled) return { run: viewOf(run) };

  const now = Date.now();
  if (now < run.startAt) return { run: viewOf(run) };
  const state = simulateRun(await inputLog(run.id), run.seed, run.startAt, Math.min(now, runHardEnd(run.startAt)));
  if (!state.over && now <= runHardEnd(run.startAt)) return { run: viewOf(run) };

  const why = (state.over?.why ?? 'closed') as 'dead' | 'left' | 'closed';
  const settled = await withWallet(wallet, async () => {
    const fresh = await load(run.id);
    if (!fresh || fresh.settled) return fresh;
    const profile = await getProfile(wallet);
    if (!profile) return fresh;
    const record: NonNullable<Run['settled']> = { why, gold: state.gold, kills: state.kills, wave: state.wave, at: now };
    if (why === 'dead') {
      // the bet was the pack; the igloo's store is untouched
      record.lost = { wood: profile.wood, ice: profile.ice, fish: profile.fish, pog: profile.pog, gold: profile.gold };
      profile.wood = 0;
      profile.ice = 0;
      profile.fish = 0;
      profile.pog = 0;
      profile.gold = 0;
      profile.items = {};
      profile.wear = {};
      record.gold = 0;
    } else {
      profile.gold += state.gold;
    }
    const saved = await putProfile(profile);
    await store.zadd(K.leaderboard, saved.pog, wallet);
    fresh.settled = record;
    await save(fresh);
    await store.del(KEY.of(wallet));
    await store.set(KEY.cooldown(wallet), 1, { ex: Math.ceil(CAVE.cooldownMs / 1000) });
    return fresh;
  });
  return { run: settled ? viewOf(settled) : viewOf(run), profile: (await getProfile(wallet)) ?? undefined };
}
