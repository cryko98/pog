import { useCallback, useEffect, useMemo, useState } from 'react';
import { furnitureThumb } from '../game/furniture';
import type { HudState } from '../game/engine';
import { api, type HomeState } from '../lib/api';
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

export type Tab = 'home' | 'shop' | 'market';

const big = (n: number) => n.toLocaleString('en-US');

/**
 * The igloo panel: what yours is worth, what you can buy for it, and the
 * market where furnished ones change hands.
 *
 * Everything here is soft $POG. The Frost ledger is next door and this
 * cannot touch it — an igloo that paid toward the airdrop would be passive
 * income toward the drop, which is the thing the gate exists to stop.
 */
export function HomePanel({ guest, refresh, hud, onPlace, onTakeNearest, onChanged, onClose, initialTab = "home" }: Props) {
  const [state, setState] = useState<HomeState | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState('250');

  const reload = useCallback(() => {
    api.home().then(setState).catch(() => {});
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

  const owned = (id: string) => (hud.inventory.items['f_' + id] || 0);

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
            {(['home', 'shop', 'market'] as Tab[]).map((t) => (
              <button key={t} className={`bp-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'home' ? 'Home' : t === 'shop' ? 'Shop' : 'Market'}
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
                      <b>{state.level.daily} $POG a day</b>
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
                            disabled={hud.inside !== state.igloo?.wallet || !!hud.placing}
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
                      disabled={busy === 'take'}
                      onClick={() => run('take', async () => {
                        const error = await onTakeNearest();
                        if (error) throw new Error(error);
                      }, 'Back in the backpack.')}
                    >
                      Take back the nearest piece
                    </button>
                  )}

                  <h5>Sell it</h5>
                  {state.listed ? (
                    <>
                      <p className="bp-note">
                        It is on the market. Buyers get the plot, the level and everything inside.
                      </p>
                      <button
                        className="btn btn-ghost btn-sm bp-wide"
                        disabled={busy === 'unlist'}
                        onClick={() => run('unlist', () => api.unlistIgloo(), 'Taken off the market.')}
                      >
                        Take it off the market
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="hm-ask">
                        <input
                          value={asking}
                          inputMode="numeric"
                          onChange={(e) => setAsking(e.target.value.replace(/[^0-9]/g, ''))}
                          aria-label="Asking price in $POG"
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={busy === 'list' || !asking}
                          onClick={() => run('list', () => api.listIgloo(Number(asking)), 'Listed.')}
                        >
                          List
                        </button>
                      </div>
                      <small className="bp-note">
                        {Math.round(state.fee * 100)}% of the sale is burned. You keep{' '}
                        {big(Math.max(0, Math.round(Number(asking || 0) * (1 - state.fee))))} $POG.
                      </small>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ---------------- the stall ---------------- */}
          {tab === 'shop' && (
            <>
              <p className="bp-note">
                Bought with $POG, placed inside, and worth <em>value</em> toward your level.
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
              {state.market.map((l) => (
                <div className="hm-listing" key={l.wallet}>
                  <div>
                    <b>
                      Level {l.level} · {l.levelLabel}
                    </b>
                    <small>
                      {l.seller}'s · {l.pieces} furnishing{l.pieces === 1 ? '' : 's'}
                    </small>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={
                      busy === l.wallet || !!state.igloo || hud.inventory.pog < l.price
                    }
                    title={state.igloo ? 'Sell your own first' : undefined}
                    onClick={() =>
                      run(l.wallet, () => api.purchaseIgloo(l.wallet), 'Bought. Welcome home.')
                    }
                  >
                    <Icon name="coin" size={13} /> {big(l.price)}
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {note && <p className="bp-feedback">{note}</p>}
    </div>
  );
}
