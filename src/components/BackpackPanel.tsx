import { useState } from 'react';
import { IGLOO, RECIPES, SKINS } from '../../shared/world.js';
import type { Inventory } from '../game/engine';
import { Icon, type IconName } from './Icon';

type Tab = 'bag' | 'craft' | 'shop';

interface Recipe {
  id: string;
  label: string;
  blurb: string;
  cost: Record<string, number>;
}

interface Skin {
  id: string;
  label: string;
  price: number;
  hat: string | null;
}

interface Props {
  inventory: Inventory;
  skins: string[];
  equipped: string;
  guest: boolean;
  onCraft: (recipe: string) => Promise<string | null>;
  onBuild: (style: string) => Promise<string | null>;
  onBuy: (skin: string) => Promise<string | null>;
  onEquip: (skin: string) => Promise<string | null>;
  onClose: () => void;
}

const RESOURCES: Array<{ key: keyof Inventory; icon: IconName; label: string }> = [
  { key: 'wood', icon: 'wood', label: 'Wood' },
  { key: 'ice', icon: 'ice', label: 'Ice' },
  { key: 'fish', icon: 'fish', label: 'Fish' },
  { key: 'pog', icon: 'coin', label: '$POG' },
];

const ITEMS: Record<string, { icon: IconName; label: string }> = {
  rod: { icon: 'rod', label: 'Fishing rod' },
  iglooKit: { icon: 'igloo', label: 'Igloo kit' },
};

export function BackpackPanel({
  inventory,
  skins,
  equipped,
  guest,
  onCraft,
  onBuild,
  onBuy,
  onEquip,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('bag');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const recipes = Object.values(RECIPES) as Recipe[];
  const catalogue = SKINS as Skin[];

  const run = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true);
    setNote('');
    const error = await fn();
    setNote(error ?? ok);
    setBusy(false);
  };

  const canAfford = (cost: Record<string, number>) =>
    Object.entries(cost).every(([res, need]) => (inventory[res as keyof Inventory] as number) >= need);

  return (
    <div className="panel side-panel backpack">
      <div className="bp-head">
        <h4>Backpack</h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="bp-tabs">
        {(['bag', 'craft', 'shop'] as Tab[]).map((t) => (
          <button key={t} className={`bp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'bag' ? 'Bag' : t === 'craft' ? 'Craft' : 'Shop'}
          </button>
        ))}
      </div>

      {guest && <p className="bp-note">Guests cannot carry anything. Connect a wallet to start gathering.</p>}

      {tab === 'bag' && (
        <>
          <div className="bp-grid">
            {RESOURCES.map((r) => (
              <div className="bp-cell" key={r.key}>
                <Icon name={r.icon} size={26} />
                <b>{inventory[r.key] as number}</b>
                <small>{r.label}</small>
              </div>
            ))}
          </div>
          <h5>Items</h5>
          {Object.entries(inventory.items).filter(([, n]) => n > 0).length === 0 ? (
            <p className="bp-note">Nothing crafted yet.</p>
          ) : (
            Object.entries(inventory.items)
              .filter(([, n]) => n > 0)
              .map(([id, n]) => (
                <div className="bp-row" key={id}>
                  <span className="with-icon">
                    <Icon name={ITEMS[id]?.icon ?? 'backpack'} size={16} />
                    {ITEMS[id]?.label ?? id}
                  </span>
                  <b>×{n}</b>
                </div>
              ))
          )}
          {inventory.items.iglooKit > 0 && (
            <button
              className="btn btn-primary btn-sm bp-wide"
              disabled={busy}
              onClick={() => run(() => onBuild(IGLOO.styles[0]), 'Igloo raised!')}
            >
              <Icon name="igloo" size={16} /> Build igloo here
            </button>
          )}
        </>
      )}

      {tab === 'craft' && (
        <>
          {recipes.map((r) => (
            <div className="bp-card" key={r.id}>
              <b>{r.label}</b>
              <small>{r.blurb}</small>
              <div className="bp-cost">
                {Object.entries(r.cost).map(([res, need]) => (
                  <span key={res} className={(inventory[res as keyof Inventory] as number) >= need ? '' : 'short'}>
                    {need} {res}
                  </span>
                ))}
              </div>
              <button
                className="btn btn-primary btn-sm bp-wide"
                disabled={busy || guest || !canAfford(r.cost)}
                onClick={() => run(() => onCraft(r.id), `Crafted ${r.label}.`)}
              >
                Craft
              </button>
            </div>
          ))}
        </>
      )}

      {tab === 'shop' && (
        <>
          <p className="bp-note">$POG only buys looks — never an advantage.</p>
          {catalogue.map((s) => {
            const owned = skins.includes(s.id);
            return (
              <div className="bp-row shop" key={s.id}>
                <span className="nm">{s.label}</span>
                {owned ? (
                  equipped === s.id ? (
                    <span className="worn">worn</span>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => run(() => onEquip(s.id), `Wearing ${s.label}.`)}
                    >
                      Wear
                    </button>
                  )
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy || guest || inventory.pog < s.price}
                    onClick={() => run(() => onBuy(s.id), `Bought ${s.label}.`)}
                  >
                    <Icon name="coin" size={14} /> {s.price}
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
