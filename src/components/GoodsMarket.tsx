import { useCallback, useEffect, useState } from 'react';
import type { Inventory } from '../game/engine';
import { api, type BazaarRules, type Good, type Lot } from '../lib/api';
import { Icon } from './Icon';

interface Props {
  wallet: string | null;
  inventory: Inventory;
  /** where the player stands, for the market's position check */
  position: () => { x: number; y: number };
  /** the pack changed — let the world re-read it */
  onChanged: () => void;
}

const GOODS: Good[] = ['wood', 'ice', 'fish'];
const big = (n: number) => n.toLocaleString('en-US');

/**
 * The goods market: lots of wood, ice and fish that players put up
 * for P coins, and a form to put up your own. The goods leave the pack
 * when a lot goes up and come back when it is taken down; a buyer pays
 * per unit for as many as they want.
 */
export function GoodsMarket({ wallet, inventory, position, onChanged }: Props) {
  const [lots, setLots] = useState<Lot[]>([]);
  const [rules, setRules] = useState<BazaarRules | null>(null);
  const [good, setGood] = useState<Good>('wood');
  const [qty, setQty] = useState('10');
  const [each, setEach] = useState('2');
  const [want, setWant] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(() => {
    api
      .lots()
      .then((r) => {
        setLots(r.lots);
        setRules(r.rules);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 6000);
    return () => clearInterval(t);
  }, [reload]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setNote('');
    try {
      await fn();
      setNote(ok);
      reload();
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That did not work.');
    }
    setBusy('');
  };

  const mine = lots.filter((l) => l.wallet === wallet);
  const theirs = lots.filter((l) => l.wallet !== wallet);
  const have = inventory[good];
  const n = Math.floor(Number(qty) || 0);
  const price = Math.floor(Number(each) || 0);
  const fee = rules?.fee ?? 0.05;

  return (
    <>
      <p className="bp-note">
        Wood, ice and fish, player to player, for P coins. A lot leaves your pack when it goes up
        and comes back if you take it down; {Math.round(fee * 100)}% of every sale is burned. Both sides
        must have qualified for the season.
      </p>

      <div className="gm-sell">
        <b>Sell</b>
        <div className="gm-goods">
          {GOODS.map((g) => (
            <button key={g} className={`bp-tab${good === g ? ' active' : ''}`} onClick={() => setGood(g)}>
              <Icon name={g} size={13} /> {g}
            </button>
          ))}
        </div>
        <div className="gm-form">
          <label>
            <span>How many</span>
            <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} />
            <small>you have {big(have)}</small>
          </label>
          <label>
            <span>P coins each</span>
            <input inputMode="numeric" value={each} onChange={(e) => setEach(e.target.value.replace(/[^\d]/g, ''))} />
            <small>{n > 0 && price > 0 ? `${big(n * price)} in all` : ' '}</small>
          </label>
          <button
            className="btn btn-primary btn-sm"
            disabled={!wallet || busy === 'list' || n < 1 || price < 1 || n > have}
            onClick={() =>
              run(
                'list',
                () => {
                  const p = position();
                  return api.listLot(good, n, price, p.x, p.y);
                },
                `${n} ${good} put up at ${price} each.`
              )
            }
          >
            Put it up
          </button>
        </div>
      </div>

      {mine.length > 0 && (
        <>
          <h5>Your lots</h5>
          {mine.map((l) => (
            <div className="hm-listing" key={l.id}>
              <div>
                <b className="with-icon">
                  <Icon name={l.good} size={14} /> {big(l.qty)} {l.good}
                </b>
                <small>{big(l.each)} P coins each · {big(l.qty * l.each)} in all</small>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy === l.id}
                onClick={() =>
                  run(
                    l.id,
                    () => {
                      const p = position();
                      return api.unlistLot(l.id, p.x, p.y);
                    },
                    'Back in your pack.'
                  )
                }
              >
                Take down
              </button>
            </div>
          ))}
        </>
      )}

      <h5>For sale</h5>
      {theirs.length === 0 && <p className="bp-note">Nothing up right now. Be the first.</p>}
      {theirs.map((l) => {
        const w = Math.max(1, Math.min(l.qty, Math.floor(Number(want[l.id] ?? '') || 1)));
        const cost = w * l.each;
        return (
          <div className="hm-listing" key={l.id}>
            <div>
              <b className="with-icon">
                <Icon name={l.good} size={14} /> {big(l.qty)} {l.good}
              </b>
              <small>
                {l.seller} · {big(l.each)} P coins each
              </small>
            </div>
            <input
              className="gm-qty"
              inputMode="numeric"
              aria-label="How many to buy"
              value={want[l.id] ?? String(Math.min(l.qty, 10))}
              onChange={(e) => setWant((prev) => ({ ...prev, [l.id]: e.target.value.replace(/[^\d]/g, '') }))}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!wallet || busy === l.id || inventory.pog < cost}
              title={inventory.pog < cost ? `That costs ${big(cost)} P coins` : undefined}
              onClick={() =>
                run(
                  l.id,
                  () => {
                    const p = position();
                    return api.buyLot(l.id, w, p.x, p.y);
                  },
                  `Bought ${w} ${l.good} for ${big(cost)} P coins.`
                )
              }
            >
              <Icon name="coin" size={13} /> {big(cost)}
            </button>
          </div>
        );
      })}

      {note && <p className="bp-feedback">{note}</p>}
    </>
  );
}
