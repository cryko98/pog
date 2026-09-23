import { useEffect, useRef, useState } from 'react';
import type { HudState } from '../game/engine';
import { currentStep, type GuideTarget } from '../game/onboarding';
import { sound } from '../game/audio';
import { Icon } from './Icon';

interface Props {
  /** who this is for; progress and dismissal are remembered per identity */
  identityId: string;
  guest: boolean;
  hud: HudState;
  /** point the on-ice arrow at the nearest node of a kind, or nowhere */
  guide: (target: GuideTarget) => void;
}

const key = (id: string) => `pog.onboard.${id}`;
const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * A small card that says the one thing to do next, with an arrow on the
 * ice to say where. It reads the player's pack rather than their clicks,
 * so it can never get stuck, and it goes away for good once the loop has
 * been walked once — or when the player says so.
 */
export function Onboarding({ identityId, guest, hud, guide }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key(identityId)) === 'done';
    } catch {
      return false;
    }
  });
  const lastIndex = useRef(-1);
  const [flash, setFlash] = useState(false);

  const { index, step, total } = currentStep({
    guest,
    moved: hud.moved,
    wood: hud.inventory.wood,
    fish: hud.inventory.fish,
    items: hud.inventory.items,
    crafts: hud.crafts,
  });

  // a chime when a step is cleared, a fanfare at the end
  useEffect(() => {
    if (dismissed) return;
    if (lastIndex.current >= 0 && index > lastIndex.current) {
      if (step) sound.buy();
      else sound.fanfare();
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
    lastIndex.current = index;
  }, [index, step, dismissed]);
  useEffect(() => {
    lastIndex.current = index;
  }, [index]);

  // the arrow follows the step
  useEffect(() => {
    guide(dismissed ? null : (step?.target ?? null));
    return () => guide(null);
  }, [dismissed, step?.target, guide]);

  // finished: remember it, and let the card linger a moment
  useEffect(() => {
    if (!step && !dismissed) {
      try {
        localStorage.setItem(key(identityId), 'done');
      } catch {
        /* private mode */
      }
      const t = setTimeout(() => setDismissed(true), 6000);
      return () => clearTimeout(t);
    }
  }, [step, dismissed, identityId]);

  if (dismissed) return null;

  const skip = () => {
    try {
      localStorage.setItem(key(identityId), 'done');
    } catch {
      /* private mode */
    }
    sound.close();
    setDismissed(true);
  };

  return (
    <div className={`onboard${flash ? ' flash' : ''}`} role="status">
      <div className="ob-head">
        <span className="ob-count">{step ? `${index + 1} / ${total}` : 'Done'}</span>
        <b>{step ? step.title : 'You know the ice now'}</b>
        <button className="bp-close" onClick={skip} aria-label="Skip the tutorial" title="Skip the tutorial">
          <Icon name="close" size={13} />
        </button>
      </div>
      <p>
        {step
          ? (touch && step.touchHint) || step.hint
          : 'Three quests wait on the board every day, the cairn pays Frost toward the airdrop, and 300 wood raises an igloo. Go and get it.'}
      </p>
      {step?.progress && (
        <div className="ob-progress">
          <small>{step.progress({ guest, moved: hud.moved, wood: hud.inventory.wood, fish: hud.inventory.fish, items: hud.inventory.items, crafts: hud.crafts })}</small>
        </div>
      )}
      <div className="ob-dots">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i < index ? 'done' : i === index ? 'now' : ''} />
        ))}
      </div>
    </div>
  );
}
