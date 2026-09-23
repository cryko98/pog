import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../App';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { api, type LeaderboardEntry, type QuestBoard } from '../lib/api';
import { PogGame, type ChatLine, type HudState, type StationKind } from '../game/engine';
import { PenguinMark } from '../components/PenguinMark';
import { ProfileModal } from '../components/ProfileModal';
import { BackpackPanel } from '../components/BackpackPanel';
import { QuestPanel } from '../components/QuestPanel';
import { SeasonPanel } from '../components/SeasonPanel';
import { HomePanel } from '../components/HomePanel';
import { ArenaPanel } from '../components/ArenaPanel';
import { DuelScene } from '../components/DuelScene';
import { DungeonScene } from '../components/DungeonScene';
import { CavePanel } from '../components/CavePanel';
import { CasinoPanel } from '../components/CasinoPanel';
import { Onboarding } from '../components/Onboarding';
import { SkillsPanel } from '../components/SkillsPanel';
import { playerLevel } from '../../shared/world.js';
import { Icon } from '../components/Icon';
import { sound } from '../game/audio';
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
  placing: null,
  inside: null,
  ownHome: false,
  moved: 0,
  crafts: {},
  skills: {},
  chat: { allowed: false, live: false, hold: 1, holdLabel: '1 $POG' },
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
  const [bagTab, setBagTab] = useState<'bag' | 'craft' | 'cook' | 'shop'>('bag');
  const [quests, setQuests] = useState<QuestBoard | null>(null);
  const [showQuests, setShowQuests] = useState(false);
  const [showSeason, setShowSeason] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  /**
   * Which plaza building is open, if any. Buildings get a window in the
   * middle of the screen rather than the side rail — you walked up to a
   * shopfront, so the shop should be what you are looking at.
   */
  const [station, setStation] = useState<StationKind | null>(null);
  /** the match being fought on the duel screen, over the world */
  const [duelId, setDuelId] = useState<string | null>(null);
  /** the run being fought in the bear caves, over the world */
  const [caveId, setCaveId] = useState<string | null>(null);
  useEffect(() => {
    gameRef.current?.setAway(duelId ? 'arena' : caveId ? 'cave' : null);
  }, [duelId, caveId]);
  /** bumped when the igloo, its furniture or its level changed */
  const [homeTick, setHomeTick] = useState(0);
  /** bumped whenever something may have moved the Frost ledger */
  const [seasonTick, setSeasonTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [audioPrefs, setAudioPrefs] = useState({ sfx: sound.sfxOn, music: sound.musicOn });
  useEffect(() => sound.onChange(() => setAudioPrefs({ sfx: sound.sfxOn, music: sound.musicOn })), []);
  useEffect(() => {
    if (canPlay) sound.begin();
  }, [canPlay]);
  const [fatal, setFatal] = useState('');
  const [booting, setBooting] = useState(true);

  const guideTo = useCallback((target: 'tree' | 'craft' | 'hole' | 'fire' | null) => {
    gameRef.current?.setGuide(target);
  }, []);

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
      onQuests: setQuests,
      onSeason: () => setSeasonTick((n) => n + 1),
      onHome: () => setHomeTick((n) => n + 1),
      onStation: (which) => {
        // walking up to a shopfront closes the side rail and opens the
        // building itself, centred
        setShowBag(false);
        setBagPinned(false);
        setShowSeason(false);
        setShowQuests(false);
        setShowBoard(false);
        setShowHome(false);
        if (which === 'fire' || which === 'craft' || which === 'shop') {
          setBagTab(which === 'fire' ? 'cook' : which);
        }
        setStation(which);
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
        if (hud.chat.allowed) chatInputRef.current?.focus();
      } else if (e.key === 'Escape' && typing) {
        chatInputRef.current?.blur();
      } else if (e.key === 'Escape' && !typing) {
        setStation(null);
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
      sound.buy();
      setProfileSkins(profile.skins);
      setEquippedSkin(profile.skin);
      gameRef.current?.applyProfile(profile);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not buy that.';
    }
  };

  const claimQuest = async (id: string): Promise<string | null> => {
    try {
      const { profile, reward, bonus } = await api.claimQuest(id);
      sound.fanfare();
      gameRef.current?.applyProfile(profile);
      setQuests(await api.quests());
      pushLine({
        id: crypto.randomUUID(),
        system: true,
        text: bonus
          ? `Quest cleared: +${reward} P coins, and +${bonus} for the streak.`
          : `Quest cleared: +${reward} P coins.`,
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not claim that.';
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
    sound.chat();
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
          <button
            className="who"
            title="Your level and trades"
            onClick={() => {
              setShowSkills((v) => !v);
              setShowSeason(false);
              setShowQuests(false);
              setShowBoard(false);
              setShowHome(false);
              setShowBag(false);
              setBagPinned(false);
            }}
          >
            <b>
              {identity!.name}
              {!identity!.guest && <span className="lvl">{playerLevel(hud.skills)}</span>}
            </b>
            <small>{identity!.guest ? 'playing as guest' : shortAddress(address, 4)}</small>
          </button>
          {identity!.guest ? (
            <button
              className="pog-counter locked"
              onClick={() => navigate('home')}
              title="Connect a Solana wallet to collect P coins"
            >
              {/* the label is a span so it can be dropped on a phone,
                  where the lock alone has to carry it */}
              <Icon name="lock" size={13} />
              <span>connect to earn</span>
            </button>
          ) : (
            <div className="pog-counter" title="P coins collected">
              <Icon name="coin" size={17} /> {hud.pog}
            </div>
          )}
        </div>

        <div className="hud-left">
          {/*
            The bag lives on its own down here rather than in the icon row.
            It is the control you reach for most, so it gets the size and
            the space to match, and it sits beside what it contains.
          */}
          <button
            className={`bag-btn${showBag ? ' active' : ''}`}
            title="Backpack, crafting and shop"
            onMouseEnter={hoverOpenBag}
            onMouseLeave={hoverCloseBag}
            onFocus={hoverOpenBag}
            onBlur={hoverCloseBag}
            onClick={() => {
              // A click pins it open so it survives the pointer wandering
              // off. It must not toggle `showBag`: hovering has already
              // opened the panel, so a toggle would close the very thing
              // the click was meant to keep.
              const next = !bagPinned;
              setBagTab('bag');
              setBagPinned(next);
              setShowBag(next);
              setShowQuests(false);
              setShowSeason(false);
              setShowHome(false);
            }}
          >
            <Icon name="backpack" size={30} />
            <span>Bag</span>
          </button>

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
        </div>

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
            className={`icon-btn${showQuests ? ' active' : ''}`}
            title="Daily quests"
            onClick={() => {
              setShowQuests((v) => !v);
              setShowBoard(false);
              setShowBag(false);
              setBagPinned(false);
            }}
          >
            <Icon name="quest" size={17} />
            {!!quests?.claimable && <i className="badge">{quests.claimable}</i>}
          </button>
          <button
            className={`icon-btn${showHome ? ' active' : ''}`}
            title="Your igloo — furnishings, level and the market"
            onClick={() => {
              setShowHome((v) => !v);
              setShowSeason(false);
              setShowQuests(false);
              setShowBoard(false);
              setShowBag(false);
              setBagPinned(false);
            }}
          >
            <Icon name="igloo" size={17} />
          </button>
          <button
            className={`icon-btn${audioPrefs.sfx ? ' active' : ''}`}
            title={audioPrefs.sfx ? 'Sound effects on' : 'Sound effects off'}
            onClick={() => sound.toggle('sfx')}
          >
            <Icon name="sound" size={17} />
          </button>
          <button
            className={`icon-btn${audioPrefs.music ? ' active' : ''}`}
            title={audioPrefs.music ? 'Music on' : 'Music off'}
            onClick={() => sound.toggle('music')}
          >
            <Icon name="music" size={17} />
          </button>
          <button
            className={`icon-btn${showSeason ? ' active' : ''}`}
            title="Season — Frost and the airdrop"
            onClick={() => {
              setShowSeason((v) => !v);
              setShowQuests(false);
              setShowBoard(false);
              setShowBag(false);
              setBagPinned(false);
            }}
          >
            <Icon name="snowflake" size={17} />
          </button>
          <button
            className={`icon-btn${showBoard ? ' active' : ''}`}
            title="Leaderboard"
            onClick={() => setShowBoard((v) => !v)}
          >
            <Icon name="trophy" size={17} />
          </button>
          <button className="icon-btn" title="Edit penguin" onClick={() => setEditing(true)}>
            <Icon name="palette" size={17} />
          </button>
          <button className="icon-btn" title="Leave the ice" onClick={() => navigate('home')}>
            <Icon name="close" size={16} />
          </button>
        </div>


        {identity && !booting && (
          <Onboarding
            identityId={identity.id}
            guest={!!identity.guest}
            hud={hud}
            guide={guideTo}
          />
        )}

        {caveId && (
          <DungeonScene
            id={caveId}
            onLeave={() => {
              setCaveId(null);
              // the coins (or the empty pack) are the truth now; show it
              void gameRef.current?.syncProfile();
              setHomeTick((n) => n + 1);
            }}
          />
        )}

        {duelId && (
          <DuelScene
            id={duelId}
            onLeave={() => {
              setDuelId(null);
              // the pot (or the loss) is in the pack now; show it
              void gameRef.current?.syncProfile();
              setHomeTick((n) => n + 1);
            }}
          />
        )}

        {station && (
          <div
            className="station-modal"
            onClick={(e) => {
              if (e.target === e.currentTarget) setStation(null);
            }}
          >
            {(station === 'craft' || station === 'shop' || station === 'fire') && (
              <BackpackPanel
                key={bagTab}
                initialTab={bagTab}
                inventory={hud.inventory}
                scarf={identity!.color}
                skins={profileSkins}
                equipped={equippedSkin}
                guest={!!identity?.guest}
                onCraft={(r) => gameRef.current?.craft(r) ?? Promise.resolve('Not in the world yet.')}
                onBuild={(st) => {
                  setStation(null);
                  gameRef.current?.startBuilding(st);
                }}
                onBuy={buySkin}
                onEquip={equipSkin}
                onClose={() => setStation(null)}
              />
            )}
            {station === 'cairn' && (
              <SeasonPanel
                guest={!!identity?.guest}
                inventory={hud.inventory}
                refresh={seasonTick}
                onOffer={(id) => gameRef.current?.offer(id) ?? Promise.resolve('Not in the world yet.')}
                onClose={() => setStation(null)}
              />
            )}
            {station === 'arena' && (
              <ArenaPanel
                guest={!!identity?.guest}
                inventory={hud.inventory}
                position={() => gameRef.current?.position() ?? { x: 0, y: 0 }}
                onEnter={(id) => {
                  setStation(null);
                  setDuelId(id);
                }}
                onClose={() => setStation(null)}
              />
            )}
            {station === 'casino' && (
              <CasinoPanel
                guest={!!identity?.guest}
                inventory={hud.inventory}
                position={() => gameRef.current?.position() ?? { x: 0, y: 0 }}
                onChanged={() => void gameRef.current?.syncProfile()}
                onClose={() => setStation(null)}
              />
            )}
            {station === 'cave' && (
              <CavePanel
                guest={!!identity?.guest}
                inventory={hud.inventory}
                position={() => gameRef.current?.position() ?? { x: 0, y: 0 }}
                onEnter={(id) => {
                  setStation(null);
                  setCaveId(id);
                }}
                onClose={() => setStation(null)}
              />
            )}
            {(station === 'furnish' || station === 'market') && (
              <HomePanel
                guest={!!identity?.guest}
                refresh={homeTick}
                hud={hud}
                initialTab={station === 'market' ? 'goods' : 'shop'}
                position={() => gameRef.current?.position() ?? { x: 0, y: 0 }}
                onPlace={(id) => {
                  setStation(null);
                  gameRef.current?.startPlacing(id);
                }}
                onTakeNearest={() =>
                  gameRef.current?.takeNearestPiece() ?? Promise.resolve('Not in the world yet.')
                }
                onChanged={() => setHomeTick((n) => n + 1)}
                onClose={() => setStation(null)}
              />
            )}
          </div>
        )}

        {showHome && !showBag && (
          <HomePanel
            guest={!!identity?.guest}
            refresh={homeTick}
            hud={hud}
            onPlace={(id) => gameRef.current?.startPlacing(id)}
            onTakeNearest={() => gameRef.current?.takeNearestPiece() ?? Promise.resolve('Not in the world yet.')}
            onChanged={() => setHomeTick((n) => n + 1)}
            onClose={() => setShowHome(false)}
          />
        )}

        {showSkills && !showBag && !showHome && !showSeason && (
          <SkillsPanel skills={hud.skills} onClose={() => setShowSkills(false)} />
        )}

        {showSeason && !showBag && !showHome && (
          <SeasonPanel
            guest={!!identity?.guest}
            inventory={hud.inventory}
            refresh={seasonTick}
            onOffer={(id) => gameRef.current?.offer(id) ?? Promise.resolve('Not in the world yet.')}
            onClose={() => setShowSeason(false)}
          />
        )}

        {showQuests && !showBag && !showSeason && !showHome && (
          <QuestPanel
            board={quests}
            guest={!!identity?.guest}
            onClaim={claimQuest}
            onClose={() => setShowQuests(false)}
          />
        )}

        {showBoard && !showBag && !showQuests && !showSeason && !showHome && (
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
          {!hud.chat.allowed ? (
            <div className="chat-locked">
              <Icon name="lock" size={13} />
              {identity?.guest
                ? 'Chat is for $POG holders. Connect a wallet that holds $POG to talk.'
                : hud.chat.live
                  ? `Chat is for $POG holders — hold at least ${hud.chat.holdLabel} to talk. You can read along.`
                  : 'Chat opens for $POG holders once the token is live.'}
            </div>
          ) : (
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
          )}
        </div>

        {hud.building && (
          <div className={'hud-prompt build' + (hud.buildOk ? ' ok' : ' bad')}>
            {hud.buildOk ? (
              <>
                <kbd>E</kbd> {hud.placing ? 'Put it here' : 'Place your igloo here'}
              </>
            ) : (
              <>
                <Icon name="warning" size={14} /> {hud.buildReason}
              </>
            )}
            <button
              className="build-cancel"
              onClick={() =>
                hud.placing ? gameRef.current?.cancelPlacing() : gameRef.current?.cancelBuilding()
              }
            >
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
            hud.chat.allowed ? 'Enter to chat' : 'Chat is for holders'
          )}
        </div>

        {/*
          A phone has no E key. Without this the entire survival layer —
          gathering, the stations, confirming a build — is unreachable on
          mobile. Hidden on fine pointers, where the keyboard does the job.
        */}
        <button
          className="touch-action"
          aria-label={hud.building ? 'Place your igloo' : 'Interact'}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* capture is best-effort; the release handlers still fire */
            }
            gameRef.current?.pressInteract();
          }}
          onPointerUp={() => gameRef.current?.releaseInteract()}
          onPointerCancel={() => gameRef.current?.releaseInteract()}
          onLostPointerCapture={() => gameRef.current?.releaseInteract()}
        >
          <Icon name={hud.building ? 'igloo' : 'hand'} size={26} />
          <span>{hud.building ? 'Place' : 'Act'}</span>
        </button>

        <div
          className="panel hud-minimap"
          onWheel={(e) => {
            e.preventDefault();
            setMapZoom(gameRef.current?.zoomMinimap(e.deltaY < 0 ? 1 : -1) ?? 1);
          }}
        >
          <canvas ref={minimapRef} width={296} height={296} />
          <div className="mm-zoom">
            <button onClick={() => setMapZoom(gameRef.current?.zoomMinimap(1) ?? 1)} disabled={mapZoom >= 4} aria-label="Zoom the map in">
              +
            </button>
            <button onClick={() => setMapZoom(gameRef.current?.zoomMinimap(-1) ?? 1)} disabled={mapZoom <= 1} aria-label="Zoom the map out">
              −
            </button>
          </div>
        </div>
      </div>

      {editing && <ProfileModal onClose={() => setEditing(false)} />}
    </div>
  );
}

export default Play;
