import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../App';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { api, type LeaderboardEntry } from '../lib/api';
import { PogGame, type ChatLine, type HudState } from '../game/engine';
import { PenguinMark } from '../components/PenguinMark';
import { ProfileModal } from '../components/ProfileModal';
import { BackpackPanel } from '../components/BackpackPanel';
import { Icon } from '../components/Icon';
import { skinById } from '../../shared/world.js';

const EMPTY_HUD: HudState = {
  online: 1,
  pog: 0,
  status: 'connecting',
  x: 0,
  y: 0,
  onIce: false,
  inventory: { pog: 0, wood: 0, ice: 0, fish: 0, items: {} },
  prompt: '',
  busy: false,
  building: false,
  buildOk: false,
  buildReason: '',
};

export function Play({ navigate }: { navigate: (r: Route) => void }) {
  const { identity, address, canPlay, restoring } = useSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<PogGame | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [showBoard, setShowBoard] = useState(false);
  const [showBag, setShowBag] = useState(false);
  const [bagTab, setBagTab] = useState<'bag' | 'craft' | 'shop'>('bag');
  const [editing, setEditing] = useState(false);
  const [fatal, setFatal] = useState('');
  const [booting, setBooting] = useState(true);

  const pushLine = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev.slice(-59), line]);
  }, []);

  // no wallet / no username => back to the landing page
  useEffect(() => {
    if (!restoring && !canPlay) navigate('home');
  }, [restoring, canPlay, navigate]);

  // read through a ref so renaming does not tear the world down
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    const me = identityRef.current;
    if (!canPlay || !me || !canvasRef.current || gameRef.current) return;

    setLines([]); // a remount must not stack another copy of the intro line
    const game = new PogGame(canvasRef.current, {
      id: me.id,
      name: me.name,
      color: me.color,
      pog: me.pog,
      guest: me.guest,
      onHud: setHud,
      onChat: pushLine,
      onFatal: setFatal,
      onStation: (which) => {
        setBagTab(which === 'craft' ? 'craft' : 'shop');
        setBagPinned(true); // opened from a station, so it stays until closed
        setShowBag(true);
      },
    });
    gameRef.current = game;
    game.start(minimapRef.current);
    setBooting(false);

    return () => {
      game.stop();
      gameRef.current = null;
    };
  }, [canPlay, pushLine]);

  useEffect(() => {
    if (!showBoard) return;
    let alive = true;
    const pull = () =>
      api
        .leaderboard()
        .then((r) => alive && setBoard(r.entries))
        .catch(() => {});
    pull();
    const timer = setInterval(pull, 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [showBoard]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // Enter focuses chat, Escape releases it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el?.tagName === 'INPUT';
      if (e.key === 'Enter' && !typing) {
        e.preventDefault();
        chatInputRef.current?.focus();
      } else if (e.key === 'Escape' && typing) {
        chatInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Skins live on the wallet profile, so they refresh through the session
  // rather than through the engine's own inventory snapshot.
  const [profileSkins, setProfileSkins] = useState<string[]>(['default']);
  const [equippedSkin, setEquippedSkin] = useState('default');

  useEffect(() => {
    if (!canPlay || identity?.guest) return;
    api
      .gameState()
      .then(({ profile }) => {
        setProfileSkins(profile.skins ?? ['default']);
        setEquippedSkin(profile.skin ?? 'default');
      })
      .catch(() => {});
  }, [canPlay, identity?.guest]);

  // keep the penguin wearing what the profile says
  useEffect(() => {
    if (!identity) return;
    gameRef.current?.setIdentity(identity.name, identity.color, skinById(equippedSkin).hat);
  }, [identity, equippedSkin]);

  const buySkin = async (skin: string): Promise<string | null> => {
    try {
      const { profile } = await api.buySkin(skin);
      setProfileSkins(profile.skins);
      setEquippedSkin(profile.skin);
      gameRef.current?.applyProfile(profile);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not buy that.';
    }
  };

  const equipSkin = async (skin: string): Promise<string | null> => {
    try {
      const { profile } = await api.equipSkin(skin);
      setEquippedSkin(profile.skin);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not equip that.';
    }
  };

  /**
   * The bag opens on hover and closes when the pointer leaves both the
   * button and the panel. A short grace period covers the gap between the
   * two, and clicking pins it open so it survives the pointer wandering.
   */
  const [bagPinned, setBagPinned] = useState(false);
  const bagTimer = useRef(0);

  const hoverOpenBag = useCallback(() => {
    clearTimeout(bagTimer.current);
    setShowBag(true);
  }, []);

  const hoverCloseBag = useCallback(() => {
    clearTimeout(bagTimer.current);
    bagTimer.current = window.setTimeout(() => {
      setShowBag((open) => (bagPinned ? open : false));
    }, 220);
  }, [bagPinned]);

  useEffect(() => () => clearTimeout(bagTimer.current), []);

  const sendChat = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    gameRef.current?.say(text.slice(0, 140));
    setDraft('');
    chatInputRef.current?.blur();
  };

  if (!canPlay) {
    return (
      <div className="game">
        <div className="game-loading">
          <div>
            <div className="spinner" />
            <p>Getting your penguin ready…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="game">
      <canvas className="stage" ref={canvasRef} />

      {(booting || fatal) && (
        <div className="game-loading">
          <div>
            {fatal ? (
              <>
                <h3 style={{ marginBottom: 10 }}>Kicked off the ice</h3>
                <p style={{ marginBottom: 20 }}>{fatal}</p>
                <button className="btn btn-primary" onClick={() => navigate('home')}>
                  Back to the surface
                </button>
              </>
            ) : (
              <>
                <div className="spinner" />
                <p>Carving the ice…</p>
              </>
            )}
          </div>
        </div>
      )}

      <div className="hud">
        <div className="panel hud-player">
          <PenguinMark scarf={identity!.color} size={34} />
          <div className="who">
            <b>{identity!.name}</b>
            <small>{identity!.guest ? 'playing as guest' : shortAddress(address, 4)}</small>
          </div>
          {identity!.guest ? (
            <button
              className="pog-counter locked"
              onClick={() => navigate('home')}
              title="Connect a Solana wallet to collect $POG"
            >
              <Icon name="lock" size={13} /> connect to earn
            </button>
          ) : (
            <div className="pog-counter" title="$POG collected">
              <Icon name="coin" size={17} /> {hud.pog}
            </div>
          )}
        </div>

        {!identity!.guest && (
          <div className="panel hud-resources">
            <span title="Wood">
              <Icon name="wood" size={15} /> {hud.inventory.wood}
            </span>
            <span title="Ice">
              <Icon name="ice" size={15} /> {hud.inventory.ice}
            </span>
            <span title="Fish">
              <Icon name="fish" size={15} /> {hud.inventory.fish}
            </span>
            {hud.inventory.items.rod > 0 && (
              <span title="Fishing rod">
                <Icon name="rod" size={15} /> {hud.inventory.items.rod}
              </span>
            )}
            {hud.inventory.items.iglooKit > 0 && (
              <span title="Igloo kit">
                <Icon name="igloo" size={15} /> {hud.inventory.items.iglooKit}
              </span>
            )}
          </div>
        )}

        <div className="hud-top-right">
          <div className="panel hud-status">
            <span className={hud.status === 'open' ? '' : 'offline'}>
              {hud.status === 'open' ? (
                <>
                  <i className="dot" style={{ display: 'inline-block', marginRight: 6 }} />
                  {hud.online} online
                </>
              ) : hud.status === 'connecting' ? (
                'connecting…'
              ) : (
                'reconnecting…'
              )}
            </span>
          </div>
          <button
            className={`icon-btn${showBoard ? ' active' : ''}`}
            title="Leaderboard"
            onClick={() => setShowBoard((v) => !v)}
          >
            <Icon name="trophy" size={17} />
          </button>
          <button
            className={`icon-btn${showBag ? ' active' : ''}`}
            title="Backpack, crafting and shop"
            onMouseEnter={hoverOpenBag}
            onMouseLeave={hoverCloseBag}
            onClick={() => {
              // a click pins it, so it survives the pointer wandering off
              setBagTab('bag');
              setBagPinned((v) => !v);
              setShowBag((v) => !v);
            }}
          >
            <Icon name="backpack" size={17} />
          </button>
          <button className="icon-btn" title="Edit penguin" onClick={() => setEditing(true)}>
            <Icon name="palette" size={17} />
          </button>
          <button className="icon-btn" title="Leave the ice" onClick={() => navigate('home')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {showBag && (
          <BackpackPanel
            key={bagTab}
            initialTab={bagTab}
            onHoverIn={hoverOpenBag}
            onHoverOut={hoverCloseBag}
            inventory={hud.inventory}
            scarf={identity!.color}
            skins={profileSkins}
            equipped={equippedSkin}
            guest={!!identity?.guest}
            onCraft={(r) => gameRef.current?.craft(r) ?? Promise.resolve('Not in the world yet.')}
            onBuild={(s) => gameRef.current?.startBuilding(s)}
            onBuy={buySkin}
            onEquip={equipSkin}
            onClose={() => {
              setBagPinned(false);
              setShowBag(false);
            }}
          />
        )}

        {showBoard && !showBag && (
          <div className="panel side-panel">
            <h4>
              <Icon name="trophy" size={16} /> Top holders on ice
            </h4>
            {board.length === 0 && <p style={{ fontSize: '0.85rem' }}>No coins banked yet.</p>}
            {board.map((e) => (
              <div className="lb-row" key={e.rank}>
                <span className="rank">{e.rank}</span>
                <span className="dot" style={{ background: e.color, animation: 'none' }} />
                <span className="nm">{e.name}</span>
                <span className="amt">{e.pog}</span>
              </div>
            ))}
          </div>
        )}

        <div className="hud-chat">
          <div className="chat-log" ref={logRef}>
            {lines.map((l) => (
              <div className={`chat-line${l.system ? ' system' : ''}`} key={l.id}>
                {l.system ? (
                  l.text
                ) : (
                  <>
                    <b style={{ color: l.color }}>{l.name}:</b> {l.text}
                  </>
                )}
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <input
              ref={chatInputRef}
              value={draft}
              maxLength={140}
              placeholder="Press Enter to chat…"
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => gameRef.current?.releaseKeys()}
              onKeyDown={(e) => {
                // explicit, so Enter sends even where implicit form submit is blocked
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <button className="btn btn-primary btn-sm" type="submit">
              Send
            </button>
          </form>
        </div>

        {hud.building && (
          <div className={'hud-prompt build' + (hud.buildOk ? ' ok' : ' bad')}>
            {hud.buildOk ? (
              <>
                <kbd>E</kbd> Place your igloo here
              </>
            ) : (
              <>
                <Icon name="warning" size={14} /> {hud.buildReason}
              </>
            )}
            <button className="build-cancel" onClick={() => gameRef.current?.cancelBuilding()}>
              Esc to cancel
            </button>
          </div>
        )}

        {hud.prompt && (
          <div className="hud-prompt">
            {/* only badge the key when pressing it would actually do something */}
            {hud.busy ? <span className="mini-spin" /> : hud.prompt.startsWith('Press E') && <kbd>E</kbd>}
            {hud.prompt.replace(/^Press E to /, '')}
          </div>
        )}

        <div className="hud-hint">
          WASD to waddle · Shift to sprint · E to gather ·{' '}
          {hud.onIce ? (
            <>
              <Icon name="snowflake" size={13} /> slippery ice!
            </>
          ) : (
            'Enter to chat'
          )}
        </div>

        <div className="panel hud-minimap">
          <canvas ref={minimapRef} width={296} height={296} />
        </div>
      </div>

      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </div>
  );
}

export default Play;
