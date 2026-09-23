import { useEffect, useState } from 'react';
import { CAVE } from '../../shared/dungeon.js';
import type { Inventory } from '../game/engine';
import { api, type RunView } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  guest: boolean;
  inventory: Inventory;
  /** where the player stands, for the cave's position check */
  position: () => { x: number; y: number };
  /** a run is on: hand over to the cave screen */
  onEnter: (id: string) => void;
  onClose: () => void;
}

const big = (n: number) => n.toLocaleString('en-US');

/**
 * The mouth of the bear caves: what is at stake, and the way in.
 *
 * The whole pack is the bet. It says so here, in numbers, before the
 * button — the igloo's store is the place for anything you would rather
 * keep.
 */
export function CavePanel({ guest, inventory, position, onEnter, onClose }: Props) {
  const [current, setCurrent] = useState<RunView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (guest) return;
    api
      .cave()
      .then((r) => setCurrent(r.run && !r.run.settled ? r.run : null))
      .catch(() => {});
  }, [guest]);

  const items = Object.values(inventory.items).reduce((a, b) => a + b, 0);
  const atRisk = [
    inventory.wood && `${big(inventory.wood)} wood`,
    inventory.ice && `${big(inventory.ice)} ice`,
    inventory.fish && `${big(inventory.fish)} fish`,
    inventory.pog && `${big(inventory.pog)} P coins`,
    items && `${items} item${items === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];

  const enter = async () => {
    setBusy(true);
    setNote('');
    try {
      const { x, y } = position();
      const { run } = await api.enterCave(x, y);
      onEnter(run.id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The cave would not have you.');
    }
    setBusy(false);
  };

  return (
    <div className="panel side-panel cave">
      <div className="bp-head">
        <h4>
          <Icon name="coin" size={16} /> Bear caves
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      <p className="bp-note">
        A corridor of ice with polar bears coming the other way — more of them, faster, and tougher the
        deeper you get. Every bear you put down with snowballs is P coins. You have {CAVE.hp} hearts; a
        swipe takes one, and a bear cannot swipe what is in the air. Walk out whenever no bear is close,
        and the coins are yours.
      </p>

      <div className="cave-risk">
        <b>If the bears get you, you lose everything in your pack.</b>
        <small>{atRisk.length ? `Right now that is ${atRisk.join(', ')}.` : 'Your pack is empty — nothing to lose.'}</small>
        <small>Anything in your igloo's store stays where it is. Put things away first if you want to keep them.</small>
      </div>

      {guest ? (
        <p className="bp-note">The caves keep a record per wallet. Connect one to go in.</p>
      ) : current ? (
        <button className="btn btn-primary bp-wide" onClick={() => onEnter(current.id)}>
          Back into your run
        </button>
      ) : (
        <button className="btn btn-primary bp-wide" disabled={busy} onClick={() => void enter()}>
          {busy ? 'Going in…' : 'Go in'}
        </button>
      )}
      {note && <p className="bp-note bp-error">{note}</p>}
      <small className="bp-note">
        A run lasts at most {CAVE.durationMs / 1000} seconds; the cave closes on its own after that and you are
        outside with what you found.
      </small>
    </div>
  );
}
