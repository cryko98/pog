/**
 * The door: who may play at all.
 *
 * Once the token is live, a wallet has to hold `PLAY.hold` $POG on chain
 * to do anything in the world — gather, build, trade, fight, bet. The
 * balance comes from the same five-minute cache the Frost gate uses, so
 * this costs nothing extra. Before the token is live everyone may play
 * (there is nothing to hold), and the team's wallets always may.
 *
 * Reading is not gated: the landing page, the season status and the
 * profile still answer, so a wallet that is short can be told exactly
 * how short.
 */

import { PLAY, mayPlay } from '../../shared/season.js';
import { holdingOf } from './chain.js';

export interface PlayGate {
  ok: boolean;
  live: boolean;
  hold: number;
  holdLabel: string;
  /** whole tokens held, as last seen */
  have: number;
}

export async function playGate(wallet: string): Promise<PlayGate> {
  const { live, balance } = await holdingOf(wallet);
  return { ok: mayPlay(wallet, balance, live), live, hold: PLAY.hold, holdLabel: PLAY.holdLabel, have: balance };
}

/** The 403 body for a wallet that may not play, or null when it may. */
export async function gateError(wallet: string): Promise<{ error: string; gate: PlayGate } | null> {
  const gate = await playGate(wallet);
  if (gate.ok) return null;
  return {
    error: `Hold at least ${gate.holdLabel} to play — this wallet holds ${gate.have.toLocaleString('en-US')}.`,
    gate,
  };
}
