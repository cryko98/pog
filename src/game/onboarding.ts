/**
 * The first few minutes, guided.
 *
 * A new penguin is told one thing at a time — move, chop, craft a rod,
 * fish, cook — with an arrow on the ice pointing at where to do it. Each
 * step is judged from what the player actually has, not from what they
 * clicked, so it cannot get stuck: a rod in the pack means the rod step
 * is done however it got there, and spending the wood afterwards does not
 * un-finish "gather 25 wood".
 */

import { RECIPES } from '../../shared/world.js';

export interface Snapshot {
  guest: boolean;
  /** world units walked since the game started */
  moved: number;
  wood: number;
  fish: number;
  items: Record<string, number>;
  /** recipes crafted this session, by count */
  crafts: Record<string, number>;
}

/** Where the arrow should point: a kind of node, or nowhere. */
export type GuideTarget = 'tree' | 'craft' | 'hole' | 'fire' | null;

export interface Step {
  id: string;
  title: string;
  hint: string;
  /** phone wording, where there are buttons instead of keys */
  touchHint?: string;
  target: GuideTarget;
  done: (s: Snapshot) => boolean;
  /** a progress readout, where one makes sense */
  progress?: (s: Snapshot) => string;
}

const ROD_WOOD = RECIPES.rod.cost.wood;
const COOK_FISH = RECIPES.cookout.cost.fish;

export const STEPS: Step[] = [
  {
    id: 'move',
    title: 'Find your feet',
    hint: 'WASD or the arrows to waddle. Hold Shift to run — and mind the ice, it is fast but slippery.',
    touchHint: 'Drag the stick to waddle. Mind the ice — it is fast but slippery.',
    target: null,
    done: (s) => s.moved > 220,
  },
  {
    id: 'wallet',
    title: 'Make it count',
    hint: 'You are a guest: you can roam and chat, but nothing is kept. Connect a wallet (top left) and what you gather is yours.',
    target: null,
    done: (s) => !s.guest,
  },
  {
    id: 'chop',
    title: 'Fell a pine',
    hint: 'Walk up to a pine and hold E. Bare flippers take fifteen swings — an axe from the workbench (8 wood) makes it five, and wears out after 25 pines.',
    touchHint: 'Walk up to a pine and hold the ACT button. Bare flippers take fifteen swings — an axe from the workbench (8 wood) makes it five, and wears out after 25 pines.',
    target: 'tree',
    done: (s) => s.wood >= 2,
  },
  {
    id: 'wood',
    title: `Gather ${ROD_WOOD} wood`,
    hint: 'A fishing rod costs that much. Trees grow back in five minutes, so move on to the next one.',
    target: 'tree',
    done: (s) => s.wood >= ROD_WOOD,
    progress: (s) => `${Math.min(s.wood, ROD_WOOD)} / ${ROD_WOOD} wood`,
  },
  {
    id: 'rod',
    title: 'Craft a rod',
    hint: 'The workbench is on the plaza. Press E at it and craft the fishing rod.',
    touchHint: 'The workbench is on the plaza. Press ACT at it and craft the fishing rod.',
    target: 'craft',
    done: (s) => (s.items.rod || 0) > 0,
  },
  {
    id: 'fish',
    title: 'Catch a fish',
    hint: 'The holes are out on the frozen lakes. Press E to cast and stay put — a bite comes in five seconds. Cast again after each one.',
    touchHint: 'The holes are out on the frozen lakes. Press ACT to cast and stay put — a bite comes in five seconds. Cast again after each one.',
    target: 'hole',
    done: (s) => s.fish >= 1,
  },
  {
    id: 'haul',
    title: `Land ${COOK_FISH} fish`,
    hint: 'Rare ones are worth more than one. Cast, wait, reel in, cast again.',
    target: 'hole',
    done: (s) => s.fish >= COOK_FISH,
    progress: (s) => `${Math.min(s.fish, COOK_FISH)} / ${COOK_FISH} fish`,
  },
  {
    id: 'cook',
    title: 'Cook your catch',
    hint: `The fire on the plaza turns ${COOK_FISH} fish into P coins. That is the in-game coin that buys hats, furniture and igloos — not the real $POG token.`,
    target: 'fire',
    done: (s) => (s.crafts.cookout || 0) + (s.crafts.feast || 0) > 0,
  },
];

/**
 * The step to show now. A step counts as done if it, or anything after
 * it, is done — so the guide only ever moves forward. Guests skip the
 * gathering steps: they are shown the wallet step instead and the rest
 * waits for them.
 */
export function currentStep(s: Snapshot): { index: number; step: Step | null; total: number } {
  const relevant = STEPS.filter((st) => (s.guest ? st.id === 'move' || st.id === 'wallet' : st.id !== 'wallet'));
  const doneFrom = relevant.map((_, i) => relevant.slice(i).some((st) => st.done(s)));
  const index = doneFrom.findIndex((d) => !d);
  return { index: index < 0 ? relevant.length : index, step: index < 0 ? null : relevant[index], total: relevant.length };
}
