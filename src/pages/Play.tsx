import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from '../App';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { api, type LeaderboardEntry } from '../lib/api';
import { PogGame, type ChatLine, type HudState } from '../game/engine';
import { PenguinMark } from '../components/PenguinMark';
import { ProfileModal } from '../components/ProfileModal';

const EMPTY_HUD: HudState = { online: 1, pog: 0, status: 'connecting', x: 0, y: 0, onIce: false };

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
    if (identity) gameRef.current?.setIdentity(identity.name, identity.color);
  }, [identity]);

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
              🔒 connect to earn
            </button>
          ) : (
            <div className="pog-counter" title="$POG collected">
              🪙 {hud.pog}
            </div>
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
            className={`icon-btn${showBoard ? ' active' : ''}`}
            title="Leaderboard"
            onClick={() => setShowBoard((v) => !v)}
          >
            🏆
          </button>
          <button className="icon-btn" title="Edit penguin" onClick={() => setEditing(true)}>
            🎨
          </button>
          <button className="icon-btn" title="Leave the ice" onClick={() => navigate('home')}>
            ✕
          </button>
        </div>

        {showBoard && (
          <div className="panel side-panel">
            <h4>🏆 Top holders on ice</h4>
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

        <div className="hud-hint">
          WASD / arrows to waddle · Shift to sprint · {hud.onIce ? '🧊 slippery ice!' : 'Enter to chat'}
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
