/**
 * The snowball arena, server side: challenges, stakes in escrow, and the
 * match itself resolved from sealed choices.
 *
 * The fight is real time and side-on (`shared/fight.js`); this file is the
 * frame around it. A client sends what the player DID — move, jump, throw
 * — and the server stamps each input with its own clock on arrival. The
 * match is then a pure function of that log: the server replays it to
 * score, and the clients replay it to draw. Nothing about position or
 * hits is ever taken from a request.
 *
 * There are no timers in a serverless API, so every deadline is applied
 * lazily: whoever reads or touches a match next moves it forward first
 * (`advance`).
 *
 * Every transition runs under the match's lock, and every stake movement
 * under the wallet's, so two requests cannot both take the same challenge
 * or both be paid.
 */

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { kv } from './kv.js';
import { withWallet } from './lock.js';
import { POG_MINT, finalizedTransaction, latestBlockhash, mintInfo } from './chain.js';
import { canPayAutomatically, payFromPool, poolAddress, poolReady } from './pool.js';
import { K, getProfile, holdCap, putProfile, trackMovement, type Profile } from './game.js';
import { GATHER, getNode } from '../../shared/world.js';
import { MEMO_PROGRAM, toBaseUnits } from '../../shared/sale.js';
import { DUEL, duelMemo, normalizeStake, verifyDepositTx } from '../../shared/duel.js';
import { FIGHT, hardEnd, outcome, simulate, validInput } from '../../shared/fight.js';

/** One thing a player did, stamped by the server. */
export interface FightInput {
  seq: number;
  t: number;
  side: 'a' | 'b';
  type: 'move' | 'jump' | 'throw';
  dir?: number;
  kind?: 'straight' | 'lob';
  targetX?: number;
  /** the client's own tag, so it can match the stamped copy to its guess */
  n?: string;
}

export type Stake = { kind: 'soft'; items: Record<string, number> } | { kind: 'pog'; amount: number };

interface Side {
  wallet: string;
  name: string;
  color: string;
  /** real-token stakes only */
  funded?: boolean;
  depositSig?: string;
}

export interface Payout {
  to: string;
  amount: number;
  kind: 'win' | 'refund';
  status: 'paid' | 'queued';
  signature?: string;
  at: number;
}

export interface Match {
  id: string;
  createdAt: number;
  stake: Stake;
  state: 'open' | 'funding' | 'live' | 'done' | 'cancelled';
  host: Side;
  challenger?: Side;
  /** live: when the clock started (after the countdown) */
  startAt?: number;
  /** the score as last replayed */
  hostHits?: number;
  challengerHits?: number;
  fundingEndsAt?: number;
  /** done: the winner's wallet, or null for a draw */
  winner?: string | null;
  reason?: string;
  endedAt?: number;
  payouts?: Payout[];
}

const KEY = {
  match: (id: string) => `pog:duel:${id}`,
  open: 'pog:duels:open',
  of: (wallet: string) => `pog:duel:of:${wallet}`,
  payouts: 'pog:payouts',
  used: (sig: string) => `pog:txused:${sig}`,
  /** the input log, one list per match */
  inputs: (id: string) => `pog:fight:${id}`,
  /** how many inputs a side sent this second */
  rate: (id: string, side: string, sec: number) => `pog:fightrate:${id}:${side}:${sec}`,
};

const MATCH_TTL = 3 * 24 * 3600;
const withMatch = <T>(id: string, fn: () => Promise<T>) => withWallet('duel:' + id, fn);

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

async function load(id: string): Promise<Match | null> {
  return (await kv()).get<Match>(KEY.match(id));
}

async function save(m: Match): Promise<void> {
  await (await kv()).set(KEY.match(m.id), m, { ex: MATCH_TTL });
}

/** The match this wallet is in, if any, brought up to date. */
export async function currentMatchId(wallet: string): Promise<string | null> {
  return (await kv()).get<string>(KEY.of(wallet));
}

const sideOf = (m: Match, wallet: string): 'host' | 'challenger' | null =>
  m.host.wallet === wallet ? 'host' : m.challenger?.wallet === wallet ? 'challenger' : null;

const stakeTotal = (items: Record<string, number>) => (items.wood || 0) + (items.ice || 0) + (items.fish || 0);

/* ------------------------------------------------------------------ *
 * Where you have to stand
 * ------------------------------------------------------------------ */

async function atArena(wallet: string, x: unknown, y: unknown): Promise<string | null> {
  const arena = getNode('station-arena');
  const px = Number(x);
  const py = Number(y);
  if (!arena) return 'The arena is not there.';
  if (!Number.isFinite(px) || !Number.isFinite(py)) return 'Where are you?';
  if (Math.hypot(px - arena.x, py - arena.y) > GATHER.range * 2.2) return 'Walk over to the arena first.';
  return trackMovement(wallet, px, py);
}

/* ------------------------------------------------------------------ *
 * Escrow
 * ------------------------------------------------------------------ */

/** Why this profile cannot cover a stake, or null. Pure, so it can run first. */
function stakeProblem(p: Profile, items: Record<string, number>): string | null {
  for (const [key, n] of Object.entries(items)) {
    if ((p[key as 'wood' | 'ice' | 'fish' | 'pog'] || 0) < n) return `You do not have ${n} ${key}.`;
  }
  // Winning doubles the resources you put up; they have to fit in the
  // pack you have earned, so the arena cannot launder a pile past the cap.
  const held = p.wood + p.ice + p.fish;
  if (held + stakeTotal(items) > holdCap(p)) {
    return 'Winning that would overfill your pack. Play a while longer, or stake less.';
  }
  return null;
}

/** Take a soft stake out of a profile, or say why not. Under the wallet lock. */
async function takeStake(wallet: string, items: Record<string, number>): Promise<{ profile?: Profile; error?: string }> {
  const p = await getProfile(wallet);
  if (!p) return { error: 'Pick a username first.' };
  const problem = stakeProblem(p, items);
  if (problem) return { error: problem };
  for (const [key, n] of Object.entries(items)) p[key as 'wood' | 'ice' | 'fish' | 'pog'] -= n;
  const saved = await putProfile(p);
  if (items.pog) await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
  return { profile: saved };
}

/** Hand a bundle to a wallet. Under the wallet lock. */
async function giveStake(wallet: string, items: Record<string, number>): Promise<void> {
  const p = await getProfile(wallet);
  if (!p) return;
  for (const [key, n] of Object.entries(items)) p[key as 'wood' | 'ice' | 'fish' | 'pog'] += n;
  const saved = await putProfile(p);
  if (items.pog) await (await kv()).zadd(K.leaderboard, saved.pog, wallet);
}

/* ------------------------------------------------------------------ *
 * Challenges
 * ------------------------------------------------------------------ */

export async function createChallenge(
  wallet: string,
  kind: unknown,
  stakeRaw: unknown,
  x: unknown,
  y: unknown
): Promise<{ match?: Match; error?: string }> {
  const store = await kv();
  if (await currentMatchId(wallet)) return { error: 'You are already in a match.' };

  let stake: Stake;
  if (kind === 'pog') {
    if (!poolReady()) return { error: 'Real $POG duels open once the token and the pool wallet are live.' };
    const amount = Math.floor(Number(stakeRaw));
    if (!Number.isFinite(amount) || amount < DUEL.minTokens || amount > DUEL.maxTokens) {
      return { error: `Stake between ${DUEL.minTokens} and ${DUEL.maxTokens.toLocaleString('en-US')} $POG.` };
    }
    stake = { kind: 'pog', amount };
  } else {
    const n = normalizeStake(stakeRaw);
    if (n.error) return { error: n.error };
    stake = { kind: 'soft', items: n.stake as Record<string, number> };
  }

  // Everything that can refuse this runs before the movement check, so a
  // stake you cannot cover does not cost you the action budget either.
  const peek = await getProfile(wallet);
  if (!peek) return { error: 'Pick a username first.' };
  if (stake.kind === 'soft') {
    const problem = stakeProblem(peek, stake.items);
    if (problem) return { error: problem };
  }

  const where = await atArena(wallet, x, y);
  if (where) return { error: where };

  return withWallet(wallet, async () => {
    if (await currentMatchId(wallet)) return { error: 'You are already in a match.' };
    const profile = await getProfile(wallet);
    if (!profile) return { error: 'Pick a username first.' };

    if (stake.kind === 'soft') {
      const taken = await takeStake(wallet, stake.items);
      if (taken.error) return { error: taken.error };
    }

    const m: Match = {
      id: newId(),
      createdAt: Date.now(),
      stake,
      state: 'open',
      host: { wallet, name: profile.name, color: profile.color },
    };
    await save(m);
    await store.zadd(KEY.open, m.createdAt, m.id);
    await store.set(KEY.of(wallet), m.id, { ex: MATCH_TTL });
    return { match: m };
  });
}

export async function cancelChallenge(wallet: string): Promise<{ ok?: boolean; error?: string }> {
  const id = await currentMatchId(wallet);
  if (!id) return { error: 'You have no challenge up.' };
  return withMatch(id, async () => {
    const m = await load(id);
    if (!m || m.host.wallet !== wallet) return { error: 'You have no challenge up.' };
    if (m.state !== 'open') return { error: 'It has already been taken.' };
    await cancel(m, 'Withdrawn.');
    return { ok: true };
  });
}

/** Withdraw or lapse an open challenge, giving the host their stake back. */
async function cancel(m: Match, reason: string): Promise<void> {
  const store = await kv();
  m.state = 'cancelled';
  m.reason = reason;
  m.endedAt = Date.now();
  await save(m);
  await store.zremRangeByScore(KEY.open, m.createdAt, m.createdAt);
  await store.del(KEY.of(m.host.wallet));
  if (m.challenger) await store.del(KEY.of(m.challenger.wallet));
  if (m.stake.kind === 'soft') {
    await withWallet(m.host.wallet, () => giveStake(m.host.wallet, (m.stake as { items: Record<string, number> }).items));
    if (m.challenger) {
      const c = m.challenger.wallet;
      await withWallet(c, () => giveStake(c, (m.stake as { items: Record<string, number> }).items));
    }
  } else {
    // whoever already paid the pool gets it back
    for (const side of [m.host, m.challenger]) {
      if (side?.funded) await queuePayout(m, side.wallet, m.stake.amount, 'refund');
    }
  }
}

export async function listOpen(): Promise<Match[]> {
  const store = await kv();
  const ids = await store.zrangeByScore(KEY.open, 0, Number.MAX_SAFE_INTEGER);
  if (!ids.length) return [];
  const rows = await store.mget<Match>(ids.map((id) => KEY.match(id)));
  const out: Match[] = [];
  const now = Date.now();
  for (const m of rows) {
    if (!m) continue;
    if (m.state !== 'open') {
      await store.zremRangeByScore(KEY.open, m.createdAt, m.createdAt);
      continue;
    }
    if (now - m.createdAt > DUEL.openMs) {
      await withMatch(m.id, async () => {
        const fresh = await load(m.id);
        if (fresh?.state === 'open') await cancel(fresh, 'Nobody took it.');
      });
      continue;
    }
    out.push(m);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function acceptChallenge(
  wallet: string,
  id: unknown,
  x: unknown,
  y: unknown
): Promise<{ match?: Match; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such challenge.' };
  const peekMatch = await load(id);
  if (!peekMatch || peekMatch.state !== 'open') return { error: 'That challenge has gone.' };
  if (peekMatch.host.wallet === wallet) return { error: 'You cannot fight yourself.' };
  if (await currentMatchId(wallet)) return { error: 'You are already in a match.' };
  const peek = await getProfile(wallet);
  if (!peek) return { error: 'Pick a username first.' };
  if (peekMatch.stake.kind === 'soft') {
    const problem = stakeProblem(peek, peekMatch.stake.items);
    if (problem) return { error: problem };
  }
  const where = await atArena(wallet, x, y);
  if (where) return { error: where };

  return withMatch(id, async () => {
    const m = await load(id);
    if (!m || m.state !== 'open') return { error: 'That challenge has gone.' };
    if (m.host.wallet === wallet) return { error: 'You cannot fight yourself.' };
    if (Date.now() - m.createdAt > DUEL.openMs) {
      await cancel(m, 'Nobody took it.');
      return { error: 'That challenge has lapsed.' };
    }

    return withWallet(wallet, async () => {
      if (await currentMatchId(wallet)) return { error: 'You are already in a match.' };
      const profile = await getProfile(wallet);
      if (!profile) return { error: 'Pick a username first.' };
      if (m.stake.kind === 'soft') {
        const taken = await takeStake(wallet, m.stake.items);
        if (taken.error) return { error: taken.error };
      }

      const store = await kv();
      m.challenger = { wallet, name: profile.name, color: profile.color };
      await store.zremRangeByScore(KEY.open, m.createdAt, m.createdAt);
      await store.set(KEY.of(wallet), m.id, { ex: MATCH_TTL });

      if (m.stake.kind === 'pog') {
        m.state = 'funding';
        m.fundingEndsAt = Date.now() + DUEL.fundMs;
      } else {
        startFight(m);
      }
      await save(m);
      return { match: m };
    });
  });
}

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

/** The countdown starts now; the clock, after it. */
function startFight(m: Match) {
  m.state = 'live';
  m.startAt = Date.now() + FIGHT.countdownMs;
}

async function inputLog(id: string): Promise<FightInput[]> {
  return (await kv()).lrange<FightInput>(KEY.inputs(id), 0, -1);
}

/**
 * Apply every deadline that has passed. Returns true when something
 * changed and the match needs saving.
 */
async function advance(m: Match): Promise<boolean> {
  const now = Date.now();

  if (m.state === 'open' && now - m.createdAt > DUEL.openMs) {
    await cancel(m, 'Nobody took it.');
    return false; // cancel() saved it
  }

  if (m.state === 'funding') {
    if (m.host.funded && m.challenger?.funded) {
      startFight(m);
      return true;
    }
    if (m.fundingEndsAt && now > m.fundingEndsAt) {
      await cancel(m, 'The stakes were not paid in time.');
      return false;
    }
    return false;
  }

  if (m.state === 'live' && m.startAt && now >= m.startAt) {
    // Replay the log to now. The score is whatever it says; if that
    // decides the match, or the clock has, settle it.
    const state = simulate(await inputLog(m.id), m.startAt, Math.min(now, hardEnd(m.startAt)));
    const result = outcome(state, m.startAt, now);
    m.hostHits = state.a.hits;
    m.challengerHits = state.b.hits;
    if (result.over) {
      const winner = result.winner === 'a' ? m.host.wallet : result.winner === 'b' ? m.challenger!.wallet : null;
      await finish(m, winner, result.reason);
    }
    return true;
  }
  return false;
}

/** Settle the stakes. Everything a winner receives was escrowed before play. */
async function finish(m: Match, winner: string | null, reason: string): Promise<void> {
  const store = await kv();
  m.state = 'done';
  m.winner = winner;
  m.reason = reason;
  m.endedAt = Date.now();
  m.payouts = m.payouts ?? [];
  await store.del(KEY.of(m.host.wallet));
  if (m.challenger) await store.del(KEY.of(m.challenger.wallet));

  const sides = [m.host, m.challenger!];
  if (m.stake.kind === 'soft') {
    const items = m.stake.items;
    if (winner) {
      // both stakes to the winner; the $POG part less the rake, burned
      const pot: Record<string, number> = {};
      for (const [k, n] of Object.entries(items)) pot[k] = n * 2;
      if (pot.pog) pot.pog -= Math.max(1, Math.round(pot.pog * DUEL.rake));
      await withWallet(winner, () => giveStake(winner, pot));
    } else {
      for (const s of sides) await withWallet(s.wallet, () => giveStake(s.wallet, items));
    }
  } else {
    const amount = m.stake.amount;
    if (winner) await queuePayout(m, winner, amount * 2, 'win');
    else for (const s of sides) await queuePayout(m, s.wallet, amount, 'refund');
  }
}

/**
 * Pay real tokens out of the pool — now, if the pool's key is on the
 * server; otherwise onto the queue `tools/payout.mjs` drains. Either way
 * it is recorded on the match, so it can be reconciled later.
 */
async function queuePayout(m: Match, to: string, amount: number, kind: 'win' | 'refund'): Promise<void> {
  const store = await kv();
  m.payouts = m.payouts ?? [];
  if (m.payouts.some((p) => p.to === to && p.kind === kind)) return; // never twice
  const entry: Payout = { to, amount, kind, status: 'queued', at: Date.now() };
  if (canPayAutomatically()) {
    const sig = await payFromPool(to, amount);
    if (sig) {
      entry.status = 'paid';
      entry.signature = sig;
    }
  }
  m.payouts.push(entry);
  await store.rpushCapped(KEY.payouts, { match: m.id, ...entry }, 10_000);
}

/** What one side sees. The log itself comes separately, by sequence. */
export function viewFor(m: Match, wallet: string) {
  const mine = sideOf(m, wallet);
  const me = mine === 'challenger' ? m.challenger! : m.host;
  const them = mine === 'challenger' ? m.host : m.challenger;
  const strip = (s: Side | undefined) => s && { wallet: s.wallet, name: s.name, color: s.color, funded: !!s.funded };
  return {
    id: m.id,
    state: m.state,
    stake: m.stake,
    createdAt: m.createdAt,
    startAt: m.startAt,
    fundingEndsAt: m.fundingEndsAt,
    serverNow: Date.now(),
    /** which side of the stage you are: the host is always 'a', on the left */
    side: (mine === 'challenger' ? 'b' : 'a') as 'a' | 'b',
    me: strip(me),
    them: strip(them),
    myHits: mine === 'challenger' ? (m.challengerHits ?? 0) : (m.hostHits ?? 0),
    theirHits: mine === 'challenger' ? (m.hostHits ?? 0) : (m.challengerHits ?? 0),
    winner: m.winner,
    won: m.state === 'done' ? m.winner === wallet : undefined,
    reason: m.reason,
    payouts: m.payouts,
    rules: FIGHT,
  };
}

export type MatchView = ReturnType<typeof viewFor>;

export async function matchState(wallet: string, id?: unknown): Promise<{ match?: MatchView; error?: string }> {
  const target = typeof id === 'string' && id ? id : await currentMatchId(wallet);
  if (!target) return { match: undefined };
  return withMatch(target, async () => {
    const m = await load(target);
    if (!m) return { match: undefined };
    if (!sideOf(m, wallet) && m.state !== 'open') return { error: 'Not your match.' };
    if (await advance(m)) await save(m);
    return { match: viewFor(m, wallet) };
  });
}

/**
 * Record something the player did. The timestamp is ours, taken on
 * arrival: a jump sent after the ball landed is a jump after the ball
 * landed, whatever the client's clock said. Not under the match lock —
 * an append is atomic on its own, and a fight cannot wait on a lock.
 */
export async function addInput(wallet: string, id: unknown, raw: unknown): Promise<{ seq?: number; t?: number; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such match.' };
  if (!validInput(raw)) return { error: 'That is not a move.' };
  const m = await load(id);
  const side = m && sideOf(m, wallet);
  if (!m || !side) return { error: 'Not your match.' };
  if (m.state !== 'live' || !m.startAt) return { error: 'The match is not on.' };
  const now = Date.now();
  if (now < m.startAt) return { error: 'Not yet — the countdown is running.' };
  if (now > hardEnd(m.startAt)) return { error: 'The match is over.' };

  const store = await kv();
  const s = side === 'host' ? 'a' : 'b';
  // a hand can only move so fast; a script gets the same ceiling
  const burst = await store.incrWithTtl(KEY.rate(id, s, Math.floor(now / 1000)), 3);
  if (burst > FIGHT.inputsPerSec) return { error: 'Slow down.' };

  const r = raw as { type: 'move' | 'jump' | 'throw'; dir?: number; kind?: 'straight' | 'lob'; targetX?: number; n?: unknown };
  const input: Omit<FightInput, 'seq'> = { t: now, side: s, type: r.type };
  if (typeof r.n === 'string' && r.n) input.n = r.n.slice(0, 12);
  if (r.type === 'move') input.dir = r.dir;
  if (r.type === 'throw') {
    input.kind = r.kind;
    if (r.kind === 'lob') input.targetX = Math.round(r.targetX!);
  }
  const seq = await store.rpushLen(KEY.inputs(id), input, 3 * 24 * 3600);
  return { seq, t: now };
}

/** The log from `since` on, for the client's picture. */
export async function inputsSince(wallet: string, id: unknown, since: unknown): Promise<{ inputs?: FightInput[]; serverNow?: number; error?: string }> {
  if (typeof id !== 'string' || !id) return { error: 'No such match.' };
  const m = await load(id);
  if (!m || !sideOf(m, wallet)) return { error: 'Not your match.' };
  const from = Math.max(0, Math.floor(Number(since) || 0));
  const rows = await (await kv()).lrange<Omit<FightInput, 'seq'>>(KEY.inputs(id), from, -1);
  return { inputs: rows.map((r, i) => ({ ...r, seq: from + i + 1 })), serverNow: Date.now() };
}

/* ------------------------------------------------------------------ *
 * Real-token stakes: into the pool, verified on chain
 * ------------------------------------------------------------------ */

export async function depositInvoice(wallet: string, id: unknown): Promise<{ transaction?: string; memo?: string; amount?: number; error?: string }> {
  if (!poolReady()) return { error: 'The pool is not live.' };
  if (typeof id !== 'string' || !id) return { error: 'No such match.' };
  const m = await load(id);
  const side = m && sideOf(m, wallet);
  if (!m || !side) return { error: 'Not your match.' };
  if (m.state !== 'funding' || m.stake.kind !== 'pog') return { error: 'Nothing to pay.' };
  const s = side === 'host' ? m.host : m.challenger!;
  if (s.funded) return { error: 'Already paid.' };

  const [mint, recent] = await Promise.all([mintInfo(), latestBlockhash()]);
  if (!mint || !recent) return { error: 'Could not reach the chain. Try again in a moment.' };

  const program = mint.program === TOKEN_2022_PROGRAM_ID.toBase58() ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintKey = new PublicKey(POG_MINT);
  const from = new PublicKey(wallet);
  const pool = new PublicKey(poolAddress());
  const fromAta = getAssociatedTokenAddressSync(mintKey, from, false, program);
  const poolAta = getAssociatedTokenAddressSync(mintKey, pool, false, program);
  const memo = duelMemo(m.id, wallet);

  const tx = new Transaction({ feePayer: from, blockhash: recent.blockhash, lastValidBlockHeight: recent.lastValidBlockHeight });
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(from, poolAta, pool, mintKey, program),
    createTransferCheckedInstruction(fromAta, mintKey, poolAta, from, toBaseUnits(m.stake.amount, mint.decimals), mint.decimals, [], program),
    new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM),
      keys: [{ pubkey: from, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, 'utf8'),
    })
  );
  return {
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    memo,
    amount: m.stake.amount,
  };
}

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

export async function confirmDeposit(wallet: string, id: unknown, signature: unknown): Promise<{ match?: MatchView; pending?: boolean; error?: string }> {
  if (!poolReady()) return { error: 'The pool is not live.' };
  if (typeof id !== 'string' || !id) return { error: 'No such match.' };
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return { error: 'That is not a signature.' };

  const m0 = await load(id);
  if (!m0 || !sideOf(m0, wallet)) return { error: 'Not your match.' };
  if (m0.state !== 'funding' || m0.stake.kind !== 'pog') return { error: 'Nothing to pay.' };
  const mint = await mintInfo();
  if (!mint) return { error: 'Could not reach the chain. Try again in a moment.' };

  const tx = await finalizedTransaction(signature);
  if (tx === null) return { error: 'Could not reach the chain. Try again in a moment.' };
  if (tx === undefined) return { pending: true };

  const verdict = verifyDepositTx(tx, {
    wallet,
    pool: poolAddress(),
    mint: POG_MINT,
    memo: duelMemo(m0.id, wallet),
    amountRaw: toBaseUnits(m0.stake.amount, mint.decimals),
  });
  if (!verdict.ok) return { error: verdict.reason };

  return withMatch(id, async () => {
    const store = await kv();
    const m = await load(id);
    const side = m && sideOf(m, wallet);
    if (!m || !side) return { error: 'Not your match.' };
    if (!(await store.setnx(KEY.used(signature), wallet, 365 * 24 * 3600))) return { error: 'That payment has already been used.' };
    if (m.state !== 'funding') {
      // paid after the window closed: the stake goes back, not into a match
      await store.del(KEY.used(signature));
      return { error: 'The match is no longer waiting for stakes. Contact support about the payment.' };
    }
    const s = side === 'host' ? m.host : m.challenger!;
    s.funded = true;
    s.depositSig = signature;
    await advance(m);
    await save(m);
    return { match: viewFor(m, wallet) };
  });
}

/** Payouts still waiting for the operator's keypair, oldest first. */
export async function queuedPayouts(): Promise<Array<Payout & { match: string }>> {
  const rows = await (await kv()).lrange<Payout & { match: string }>(KEY.payouts, 0, -1);
  return rows.filter((p) => p.status === 'queued');
}
