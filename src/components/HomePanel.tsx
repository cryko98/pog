import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { furnitureThumb } from '../game/furniture';
import type { HudState } from '../game/engine';
import { api, type HomeState, type IglooListing, type ListingCurrency } from '../lib/api';
import { canSendTransactions, shortAddress, signAndSendTransaction } from '../lib/wallet';
import { useSession } from '../state/session';
import { Icon } from './Icon';

interface Props {
  guest: boolean;
  /** bumped by the engine whenever the igloo changed */
  refresh: number;
  hud: HudState;
  onPlace: (id: string) => void;
  onTakeNearest: () => Promise<string | null>;
  onChanged: () => void;
  onClose: () => void;
  /** which tab the building that opened this wants to show */
  initialTab?: Tab;
}

export type Tab = 'home' | 'store' | 'shop' | 'market';

const big = (n: number) => n.toLocaleString('en-US');

/** Where an on-chain purchase is, step by step, so the panel can say so. */
type Checkout =
  | { step: 'idle' }
  | { step: 'reserving'; seller: string }
  | { step: 'signing'; seller: string; price: number; burn: number }
  | { step: 'settling'; seller: string; signature: string }
  | { step: 'done'; seller: string }
  | { step: 'failed'; seller: string; reason: string };

/**
 * The igloo panel: what yours is worth, what you can buy for it, and the
 * market where furnished ones change hands.
 *
 * Two kinds of listing. Soft ones settle here in P coins. On-chain
 * ones settle in the real token, and the panel's whole job for those is
 * to walk the buyer through reserve -> sign -> settle without ever
 * touching a key: the server builds the payment, the wallet signs it, the
 * chain records it, and the server reads it back. The Frost ledger is
 * next door and none of this can touch it.
 */
export function HomePanel({ guest, refresh, hud, onPlace, onTakeNearest, onChanged, onClose, initialTab = 'home' }: Props) {
  const { connected } = useSession();
  const [state, setState] = useState<HomeState | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState('250');
  const [currency, setCurrency] = useState<ListingCurrency>('soft');
  const [checkout, setCheckout] = useState<Checkout>({ step: 'idle' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    api.home().then((s) => alive.current && setState(s)).catch(() => {});
  }, []);

  useEffect(() => {
    if (guest) return;
    reload();
    const timer = setInterval(reload, 20_000);
    return () => clearInterval(timer);
  }, [guest, refresh, reload]);

  // Thumbnails are drawn once from the same code that draws the real
  // thing, so a shop row can never disagree with what you get.
  const thumbs = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of state?.catalogue ?? []) out[f.id] = furnitureThumb(f.id, 48);
    return out;
  }, [state?.catalogue]);

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

  const owned = (id: string) => hud.inventory.items['f_' + id] || 0;

  /**
   * The on-chain purchase. Each step can fail on its own and says why;
   * nothing is retried silently, because the one thing that must never
   * happen is paying twice.
   */
  const buyOnChain = async (l: IglooListing) => {
    if (!connected) {
      setNote('Reconnect your wallet to pay on chain.');
      return;
    }
    if (!canSendTransactions(connected)) {
      setNote('This wallet can sign messages but not send transactions.');
      return;
    }
    setNote('');
    try {
      setCheckout({ step: 'reserving', seller: l.wallet });
      await api.reserveSale(l.wallet);
      const { invoice } = await api.saleInvoice(l.wallet);

      setCheckout({ step: 'signing', seller: l.wallet, price: invoice.price, burn: invoice.burn });
      const signature = await signAndSendTransaction(connected, invoice.transaction);

      setCheckout({ step: 'settling', seller: l.wallet, signature });
      // Finality takes a dozen seconds or so. Ask until the chain has it.
      for (let attempt = 0; attempt < 40; attempt++) {
        const r = await api.settleSale(l.wallet, signature);
        if (!r.pending) break;
        await new Promise((res) => setTimeout(res, 3000));
      }
      setCheckout({ step: 'done', seller: l.wallet });
      reload();
      onChanged();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'That did not work.';
      setCheckout({ step: 'failed', seller: l.wallet, reason });
    }
  };

  const chainOpen = !!state?.chain?.live;
  const fee = currency === 'pog' ? state?.chain?.fee ?? 0.08 : state?.fee ?? 0.08;
  const askNumber = Number(asking || 0);

  return (
    <div className="panel side-panel home">
      <div className="bp-head">
        <h4>
          <Icon name="igloo" size={16} /> Your igloo
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      {guest ? (
        <p className="bp-note">An igloo belongs to a wallet. Connect one to build, furnish and trade.</p>
      ) : !state ? (
        <p className="bp-note">Checking the deeds…</p>
      ) : (
        <>
          <div className="bp-tabs">
            {(['home', 'store', 'shop', 'market'] as Tab[]).map((t) => (
              <button key={t} className={`bp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'home' ? 'Home' : t === 'store' ? 'Store' : t === 'shop' ? 'Shop' : 'Market'}
              </button>
            ))}
          </div>

          {/* ---------------- your igloo ---------------- */}
          {tab === 'home' && (
            <>
              {!state.igloo ? (
                <p className="bp-note">
                  No igloo yet. Craft a kit at the workbench — 300 wood and 120 ice — and raise one on
                  clear snow.
                </p>
              ) : (
                <>
                  <div className="hm-level">
                    <b>
                      Level {state.level.level} · {state.level.label}
                    </b>
                    <small>
                      {state.pieces.length} / {state.limit} furnishings · {state.level.value} value
                    </small>
                    <div className="q-bar">
                      <i
                        style={{
                          width: state.level.next
                            ? `${Math.min(100, (state.level.value / state.level.next.needs) * 100)}%`
                            : '100%',
                        }}
                      />
                    </div>
                    <small>
                      {state.level.next
                        ? `${state.level.next.needs - state.level.value} more value for ${state.level.next.label} (${state.level.next.daily}/day)`
                        : 'The highest there is.'}
                    </small>
                  </div>

                  <div className="hm-yield">
                    <Icon name="coin" size={18} />
                    <div>
                      <b>{state.level.daily} P coins a day</b>
                      <small>
                        {state.collected > 0
                          ? `Just collected ${state.collected}.`
                          : state.level.daily
                            ? 'Paid automatically when you play.'
                            : 'Furnish it to start earning.'}
                      </small>
                    </div>
                  </div>

                  {hud.inside === state.igloo.wallet ? (
                    <small className="bp-note">
                      You are inside. Pick a furnishing below to place it, or stand next to one and take
                      it back.
                    </small>
                  ) : (
                    <small className="bp-note">Step inside your igloo to arrange the furniture.</small>
                  )}

                  <h5>In the backpack</h5>
                  {(state.catalogue ?? []).filter((f) => owned(f.id) > 0).length === 0 ? (
                    <p className="bp-note">Nothing to place. Buy something at the stall.</p>
                  ) : (
                    state.catalogue
                      .filter((f) => owned(f.id) > 0)
                      .map((f) => (
                        <div className="hm-row" key={f.id}>
                          <img src={thumbs[f.id]} alt="" width={40} height={40} />
                          <span className="nm">
                            {f.label} <em>×{owned(f.id)}</em>
                          </span>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={hud.inside !== state.igloo?.wallet || !!hud.placing || state.listed}
                            onClick={() => onPlace(f.id)}
                          >
                            Place
                          </button>
                        </div>
                      ))
                  )}

                  {hud.ownHome && state.pieces.length > 0 && (
                    <button
                      className="btn btn-ghost btn-sm bp-wide"
                      style={{ marginTop: 10 }}
                      disabled={busy === 'take' || state.listed}
                      onClick={() =>
                        run(
                          'take',
                          async () => {
                            const error = await onTakeNearest();
                            if (error) throw new Error(error);
                          },
                          'Back in the backpack.'
                        )
                      }
                    >
                      Take back the nearest piece
                    </button>
                  )}

                  <h5>Sell it</h5>
                  {state.listed ? (
                    <>
                      <p className="bp-note">
                        {state.reserved
                          ? 'A buyer is paying for it right now. It is locked until they finish or the ten minutes run out.'
                          : 'It is on the market. Buyers get the plot, the level and everything inside.'}
                      </p>
                      <button
                        className="btn btn-ghost btn-sm bp-wide"
                        disabled={busy === 'unlist' || state.reserved}
                        onClick={() => run('unlist', () => api.unlistIgloo(), 'Taken off the market.')}
                      >
                        Take it off the market
                      </button>
                    </>
                  ) : (
                    <>
                      {chainOpen && (
                        <div className="hm-cur" role="radiogroup" aria-label="Sell for">
                          <button
                            className={`hm-cur-btn${currency === 'soft' ? ' active' : ''}`}
                            onClick={() => setCurrency('soft')}
                          >
                            <Icon name="coin" size={12} /> P coins
                          </button>
                          <button
                            className={`hm-cur-btn${currency === 'pog' ? ' active' : ''}`}
                            onClick={() => setCurrency('pog')}
                          >
                            ◎ Real $POG
                          </button>
                        </div>
                      )}
                      <div className="hm-ask">
                        <input
                          value={asking}
                          inputMode="numeric"
                          onChange={(e) => setAsking(e.target.value.replace(/[^0-9]/g, ''))}
                          aria-label="Asking price"
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy === 'list' || !asking}
                          onClick={() => run('list', () => api.listIgloo(askNumber, currency), 'Listed.')}
                        >
                          List
                        </button>
                      </div>
                      <small className="bp-note">
                        {Math.round(fee * 100)}% of the sale is burned
                        {currency === 'pog' ? ' on chain by the buyer' : ''}. You keep{' '}
                        {big(Math.max(0, Math.round(askNumber * (1 - fee))))}{' '}
                        {currency === 'pog' ? 'real $POG' : 'P coins'}.
                      </small>
                      {currency === 'pog' && (
                        <small className="bp-note">
                          Paid straight to your wallet, not to the game. Nothing is escrowed: the buyer
                          pays you on chain and the igloo moves once the payment is final.
                        </small>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ---------------- the store ---------------- */}
          {tab === 'store' && (
            <>
              {!state.igloo ? (
                <p className="bp-note">Raise an igloo first — then anything you put away in it is safe from the caves.</p>
              ) : (
                <>
                  <p className="bp-note">
                    What is put away here stays here if a run in the caves goes wrong. Pack and store
                    share the same cap, so this is a safe place, not a bigger pack.
                    {hud.inside !== state.igloo.wallet && ' Step inside to move things.'}
                  </p>
                  {(['wood', 'ice', 'fish', 'pog', 'gold'] as const).map((k) => {
                    const inPack = hud.inventory[k] as number;
                    const put = state.store?.[k] ?? 0;
                    const label = k === 'pog' ? 'P coins' : k;
                    const move = (dir: 'in' | 'out', n: number) => {
                      if (n <= 0 || !state.igloo) return;
                      const p = { x: state.igloo.x, y: state.igloo.y };
                      run(
                        k + dir,
                        () => (dir === 'in' ? api.depositIgloo({ [k]: n }, p.x, p.y) : api.withdrawIgloo({ [k]: n }, p.x, p.y)),
                        dir === 'in' ? `${n} ${label} put away.` : `${n} ${label} back in the pack.`
                      );
                    };
                    return (
                      <div className="st-row" key={k}>
                        <span className="with-icon st-name">
                          <Icon name={k === 'pog' ? 'coin' : k} size={15} /> {label}
                        </span>
                        <span className="st-nums">
                          pack <b>{inPack}</b> · igloo <b>{put}</b>
                        </span>
                        <span className="st-btns">
                          <button className="duel-btn" disabled={inPack <= 0 || busy === k + 'in'} onClick={() => move('in', inPack)} title="Put all of it away">
                            all in
                          </button>
                          <button className="duel-btn" disabled={put <= 0 || busy === k + 'out'} onClick={() => move('out', put)} title="Take all of it back">
                            all out
                          </button>
                        </span>
                      </div>
                    );
                  })}
                  <h5>Items</h5>
                  {(() => {
                    const ids = new Set([...Object.keys(hud.inventory.items), ...Object.keys(state.store?.items ?? {})]);
                    const rows = [...ids].filter((id) => (hud.inventory.items[id] || 0) + (state.store?.items[id] || 0) > 0);
                    if (!rows.length) return <p className="bp-note">Nothing crafted or bought yet.</p>;
                    return rows.map((id) => {
                      const inPack = hud.inventory.items[id] || 0;
                      const put = state.store?.items[id] || 0;
                      const name = id.startsWith('f_') ? (state.catalogue.find((f) => 'f_' + f.id === id)?.label ?? id.slice(2)) : id === 'iglooKit' ? 'Igloo kit' : id === 'pick' ? 'Ice pick' : id.charAt(0).toUpperCase() + id.slice(1);
                      const move = (dir: 'in' | 'out', n: number) => {
                        if (n <= 0 || !state.igloo) return;
                        const p = { x: state.igloo.x, y: state.igloo.y };
                        run(id + dir, () => (dir === 'in' ? api.depositIgloo({ items: { [id]: n } }, p.x, p.y) : api.withdrawIgloo({ items: { [id]: n } }, p.x, p.y)), dir === 'in' ? `${name} put away.` : `${name} back in the pack.`);
                      };
                      return (
                        <div className="st-row" key={id}>
                          <span className="st-name">{name}</span>
                          <span className="st-nums">
                            pack <b>{inPack}</b> · igloo <b>{put}</b>
                          </span>
                          <span className="st-btns">
                            <button className="duel-btn" disabled={inPack <= 0 || busy === id + 'in'} onClick={() => move('in', inPack)}>
                              all in
                            </button>
                            <button className="duel-btn" disabled={put <= 0 || busy === id + 'out'} onClick={() => move('out', put)}>
                              all out
                            </button>
                          </span>
                        </div>
                      );
                    });
                  })()}
                </>
              )}
            </>
          )}

          {/* ---------------- the stall ---------------- */}
          {tab === 'shop' && (
            <>
              <p className="bp-note">
                Bought with P coins, placed inside, and worth <em>value</em> toward your level.
              </p>
              {state.catalogue.map((f) => (
                <div className="hm-row" key={f.id}>
                  <img src={thumbs[f.id]} alt="" width={40} height={40} />
                  <span className="nm">
                    {f.label}
                    <small>
                      {f.blurb} · +{f.value} value
                    </small>
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === f.id || hud.inventory.pog < f.price}
                    onClick={() => run(f.id, () => api.buyFurniture(f.id, 1), `Bought ${f.label}.`)}
                  >
                    <Icon name="coin" size={13} /> {f.price}
                  </button>
                </div>
              ))}
            </>
          )}

          {/* ---------------- the market ---------------- */}
          {tab === 'market' && (
            <>
              <p className="bp-note">
                A sale hands over the plot, the level and every furnishing in it. Both sides have to
                have qualified for the season.
              </p>
              {state.market.length === 0 && <p className="bp-note">Nothing for sale right now.</p>}
              {state.market.map((l) => {
                const onChain = l.currency === 'pog';
                const mine = checkout.step !== 'idle' && checkout.seller === l.wallet ? checkout : null;
                const inFlight = mine && (mine.step === 'reserving' || mine.step === 'signing' || mine.step === 'settling');
                return (
                  <div className="hm-listing" key={l.wallet}>
                    <div>
                      <b>
                        Level {l.level} · {l.levelLabel}
                        {onChain && <span className="hm-tag">on chain</span>}
                      </b>
                      <small>
                        {l.seller}'s · {l.pieces} furnishing{l.pieces === 1 ? '' : 's'}
                        {onChain ? ` · to ${shortAddress(l.wallet)}` : ''}
                      </small>
                      {mine && (
                        <small className={`hm-step${mine.step === 'failed' ? ' bad' : ''}`}>
                          {mine.step === 'reserving' && 'Holding it for you…'}
                          {mine.step === 'signing' &&
                            `Approve in your wallet: ${big(mine.price - mine.burn)} to the seller, ${big(mine.burn)} burned.`}
                          {mine.step === 'settling' && 'Sent. Waiting for the chain to finalise it…'}
                          {mine.step === 'done' && 'Yours. Welcome home.'}
                          {mine.step === 'failed' && mine.reason}
                        </small>
                      )}
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={
                        !!inFlight ||
                        busy === l.wallet ||
                        !!state.igloo ||
                        (!onChain && hud.inventory.pog < l.price)
                      }
                      title={state.igloo ? 'Sell your own first' : undefined}
                      onClick={() =>
                        onChain
                          ? buyOnChain(l)
                          : run(l.wallet, () => api.purchaseIgloo(l.wallet), 'Bought. Welcome home.')
                      }
                    >
                      {onChain ? '◎' : <Icon name="coin" size={13} />} {big(l.price)}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
