import { useState } from 'react';
import { FISH, GATHER, IGLOO, RARITY, RECIPES, RESOURCE_KEYS, SKINS } from '../../shared/world.js';
import type { Inventory } from '../game/engine';
import { Icon, type IconName } from './Icon';
import { PenguinPreview } from './PenguinPreview';

type Tab = 'bag' | 'craft' | 'cook' | 'shop';

const TAB_LABEL: Record<Tab, string> = { bag: 'Bag', craft: 'Craft', cook: 'Cook', shop: 'Shop' };

interface Recipe {
  id: string;
  label: string;
  blurb: string;
  station: string;
  cost: Record<string, number>;
  gives: Record<string, number>;
}

interface Skin {
  id: string;
  label: string;
  price: number;
  hat: string | null;
}

interface Props {
  inventory: Inventory;
  scarf: string;
  skins: string[];
  equipped: string;
  guest: boolean;
  onCraft: (recipe: string) => Promise<string | null>;
  onBuild: (style: string) => void;
  onBuy: (skin: string) => Promise<string | null>;
  onEquip: (skin: string) => Promise<string | null>;
  onClose: () => void;
  initialTab?: Tab;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
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
  scarf,
  skins,
  equipped,
  guest,
  onCraft,
  onBuild,
  onBuy,
  onEquip,
  onClose,
  initialTab = 'bag',
  onHoverIn,
  onHoverOut,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [style, setStyle] = useState<string>((IGLOO.styles as string[])[0]);
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
    <div
      className="panel side-panel backpack"
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      <div className="bp-head">
        <h4>Backpack</h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="bp-tabs">
        {(['bag', 'craft', 'cook', 'shop'] as Tab[]).map((t) => (
          <button key={t} className={`bp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
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
          <h5>Tackle box</h5>
          <p className="bp-note">
            Cast at a hole and a bite comes every {GATHER.hole.biteMs / 1000} seconds. What bites is
            luck — and a little skill.
          </p>
          {Object.values(FISH).map((f) => {
            const n = inventory.fishLog?.[f.id] || 0;
            const tone = RARITY[f.rarity as keyof typeof RARITY];
            return (
              <div className="bp-row" key={f.id}>
                <span className="with-icon">
                  <i className="fish-dot" style={{ background: tone.color }} />
                  {n > 0 ? f.label : '???'}
                  <small className="fish-rarity" style={{ color: tone.color }}>
                    {tone.label} · {f.fish} fish
                  </small>
                </span>
                <b>{n > 0 ? `×${n}` : '—'}</b>
              </div>
            );
          })}
          {inventory.items.iglooKit > 0 && (
            <div className="bp-build">
              <h5>Raise an igloo</h5>
              <div className="bp-styles">
                {(IGLOO.styles as string[]).map((st) => (
                  <button
                    key={st}
                    className={`bp-style${style === st ? ' active' : ''}`}
                    onClick={() => setStyle(st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-primary btn-sm bp-wide"
                disabled={busy}
                onClick={() => {
                  onBuild(style);
                  onClose();
                }}
              >
                <Icon name="igloo" size={16} /> Place it
              </button>
              <small className="bp-note">
                You will carry a ghost igloo — walk to clear snow and press E.
              </small>
            </div>
          )}
        </>
      )}

      {(tab === 'craft' || tab === 'cook') && (
        <>
          {tab === 'cook' && (
            <p className="bp-note">
              <Icon name="fire" size={14} /> The plaza fire is the only thing a raw fish is good for.
            </p>
          )}
          {recipes
            .filter((r) => r.station === (tab === 'cook' ? 'fire' : 'craft'))
            .map((r) => (
              <div className="bp-card" key={r.id}>
                <b>{r.label}</b>
                <small>{r.blurb}</small>
                <div className="bp-cost">
                  {Object.entries(r.cost).map(([res, need]) => (
                    <span
                      key={res}
                      className={(inventory[res as keyof Inventory] as number) >= need ? '' : 'short'}
                    >
                      {need} {res}
                    </span>
                  ))}
                  {/* only a payout worth spelling out — the card title
                      already names the item a craft hands you */}
                  {Object.entries(r.gives)
                    .filter(([res]) => RESOURCE_KEYS.includes(res))
                    .map(([res, amount]) => (
                      <span key={res} className="gain">
                        +{amount} {res === 'pog' ? '$POG' : res}
                      </span>
                    ))}
                </div>
                <button
                  className="btn btn-primary btn-sm bp-wide"
                  disabled={busy || guest || !canAfford(r.cost)}
                  onClick={() => run(() => onCraft(r.id), `${tab === 'cook' ? 'Cooked' : 'Crafted'} ${r.label}.`)}
                >
                  {tab === 'cook' ? 'Cook' : 'Craft'}
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
                <PenguinPreview scarf={scarf} hat={s.hat} size={34} />
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
