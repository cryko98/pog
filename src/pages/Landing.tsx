import { useEffect, useState } from 'react';
import type { Route } from '../App';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { api } from '../lib/api';
import { PenguinMark } from '../components/PenguinMark';
import { WalletModal } from '../components/WalletModal';
import { ProfileModal } from '../components/ProfileModal';

const CONTRACT = import.meta.env.VITE_POG_CONTRACT ?? 'TBA — dropping at launch';

const FEATURES = [
  {
    icon: '🧊',
    title: 'One frozen open world',
    body: 'A 6.4 × 6.4 km snowfield of pine forests, frozen lakes and lantern-lit plazas — no lobbies, no instances. Everyone waddles the same map.',
  },
  {
    icon: '👀',
    title: 'Real multiplayer',
    body: 'Connect your wallet and your penguin pops into the spawn plaza. Every other holder sees you move, slide and chat in real time.',
  },
  {
    icon: '🪙',
    title: 'Play to earn',
    body: '$POG coins scatter across the ice. Scoop them up, climb the leaderboard, and bank score that maps to on-chain rewards.',
  },
  {
    icon: '🔑',
    title: 'Your wallet is your name',
    body: 'One signature — free, off-chain, zero approvals — and your username plus scarf colour is bound to your address forever.',
  },
];

const STEPS = [
  { title: 'Connect', body: 'Phantom, Solflare, Backpack — any Solana wallet. We only ask for a signature, never a transaction.' },
  { title: 'Name your penguin', body: 'Pick a username and scarf colour. It is saved to your wallet, so it follows you on any device.' },
  { title: 'Hit PLAY', body: 'You spawn in the plaza under the $POG banner, right next to everyone else who is online.' },
  { title: 'Waddle & earn', body: 'WASD to move, Shift to sprint. Hit a frozen lake and you belly-slide — faster, but you keep your momentum. Collect coins, stack $POG.' },
];

const TOKENOMICS = [
  ['Ticker', '$POG'],
  ['Network', 'Solana (SPL)'],
  ['Total supply', '1,000,000,000'],
  ['Buy / sell tax', '0% / 0%'],
  ['LP', 'Burned at launch'],
  ['Mint & freeze authority', 'Revoked'],
];

const ROADMAP = [
  {
    phase: 'Phase 1 — Ice break',
    done: true,
    items: ['Token launch on Solana', 'Landing page + wallet login', 'Spawn plaza & multiplayer world', 'Username bound to wallet'],
  },
  {
    phase: 'Phase 2 — Waddle',
    items: ['$POG pickups & leaderboard', 'Emotes and proximity chat', 'Penguin cosmetics (hats, scarves)', 'Mobile touch controls'],
  },
  {
    phase: 'Phase 3 — Blizzard',
    items: ['Snowball PvP zones', 'Ice fishing minigame', 'Player-built igloos & guilds', 'Daily quests'],
  },
  {
    phase: 'Phase 4 — Glacier',
    items: ['On-chain reward claims', 'NFT penguin skins', 'Seasonal tournaments', 'Community-built zones'],
  },
];

export function Landing({ navigate }: { navigate: (r: Route) => void }) {
  const { status, profile, guest, identity, address, canPlay, playAsGuest, logout, restoring } = useSession();
  const [walletOpen, setWalletOpen] = useState(false);
  const [profileMode, setProfileMode] = useState<'setup' | 'edit' | null>(null);
  const [stats, setStats] = useState({ online: 0, wallets: 0 });
  const [serverUp, setServerUp] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = () =>
      api
        .stats()
        .then((s) => {
          if (!alive) return;
          setStats(s);
          setServerUp(true);
        })
        .catch(() => alive && setServerUp(false));
    pull();
    const timer = setInterval(pull, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // as soon as the wallet is authenticated, ask for a username if missing
  useEffect(() => {
    if (status === 'ready' && !profile?.name) setProfileMode('setup');
  }, [status, profile?.name]);

  const play = () => {
    if (canPlay) navigate('play');
    else if (status === 'ready') setProfileMode('setup');
    else setWalletOpen(true);
  };

  const playGuest = () => {
    playAsGuest();
    navigate('play');
  };

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address is on screen anyway */
    }
  };

  return (
    <div className="landing">
      <div className="aurora" />

      {!serverUp && (
        <div className="server-down">
          ⚠️ The $POG API is not responding, so wallet login is unavailable right now.
          {location.hostname === 'localhost' && (
            <>
              {' '}
              Start it with <code>npm run dev</code>.
            </>
          )}
        </div>
      )}

      <header className="nav">
        <div className="shell nav-inner">
          <a className="brand" href="#/">
            <img src="/poglogo.jpg" alt="" />
            <span>$POG</span>
          </a>
          <nav className="nav-links">
            <a href="#game">Game</a>
            <a href="#how">How to play</a>
            <a href="#token">Tokenomics</a>
            <a href="#roadmap">Roadmap</a>
          </nav>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {identity && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setProfileMode('edit')}
                title={identity.guest ? 'Guest penguin — saved in this browser' : shortAddress(address)}
              >
                {identity.guest ? '👤' : '🐧'} {identity.name}
              </button>
            )}
            {status === 'ready' ? (
              <button className="btn btn-ghost btn-sm" onClick={logout} title="Disconnect">
                ⏻
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setWalletOpen(true)} disabled={restoring}>
                Connect wallet
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="shell hero">
          <div>
            <span className="pill">
              <i className="dot" /> Live on Solana
            </span>
            <h1>
              Waddle. Slide.
              <br />
              <em>Earn $POG.</em>
            </h1>
            <p className="lead">
              $POG is the coldest memecoin on Solana — and the only one with a real open world behind
              it. Connect your wallet, drop onto the ice, and share a living snowfield with every
              other holder online right now.
            </p>

            <div className="hero-cta">
              <button className="btn btn-play" onClick={play} disabled={restoring}>
                ▶ PLAY
              </button>
              {!canPlay && (
                <button className="btn btn-ghost" onClick={playGuest} disabled={restoring}>
                  Play as guest
                </button>
              )}
              <a className="btn btn-ghost" href="#how">
                How it works
              </a>
            </div>

            <p className="cta-note">
              {guest
                ? 'You are exploring as a guest. Connect a wallet to keep your name and start earning $POG.'
                : 'No wallet? Jump straight in as a guest — you can roam and chat, but $POG is only credited to a wallet.'}
            </p>

            <div className="hero-stats">
              <div className="stat">
                <b>{stats.online}</b>
                <span>Penguins online</span>
              </div>
              <div className="stat">
                <b>{stats.wallets}</b>
                <span>Wallets on the ice</span>
              </div>
              <div className="stat">
                <b>260</b>
                <span>$POG coins to find</span>
              </div>
            </div>
          </div>

          <div className="hero-art">
            <div className="glow" />
            <PenguinMark scarf={profile?.color ?? '#ff6b2c'} />
            <div className="ice-disc" />
          </div>
        </section>

        <section className="band shell" id="game">
          <div className="section-head">
            <span className="pill">The game</span>
            <h2>A memecoin you can actually walk around in</h2>
            <p>
              No roadmap promises of a game "coming soon". Open the site, sign a message, and you are
              standing in it — a tilted top-down snowfield rendered live in your browser.
            </p>
          </div>
          <div className="grid grid-4">
            {FEATURES.map((f) => (
              <article className="card feature" key={f.title}>
                <div className="ico">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="band shell" id="how">
          <div className="section-head">
            <span className="pill">How to play</span>
            <h2>From wallet to waddle in four steps</h2>
          </div>
          <div className="grid grid-4 steps">
            {STEPS.map((s) => (
              <article className="card step" key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="band shell" id="token">
          <div className="section-head">
            <span className="pill">Tokenomics</span>
            <h2>Simple, fair, frozen solid</h2>
          </div>
          <div className="token-grid">
            <div className="card">
              {TOKENOMICS.map(([k, v]) => (
                <div className="token-row" key={k}>
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="ca">
                <code>{CONTRACT}</code>
                <button className="btn btn-ghost btn-sm" onClick={copyContract} style={{ marginLeft: 'auto' }}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Play to earn, honestly explained</h3>
              <p>
                Every $POG coin you pick up in the world is recorded against your wallet on the game
                server and shown on the live leaderboard. Those points are the ledger for future
                on-chain reward distributions from the community treasury.
              </p>
              <p style={{ marginTop: 14 }}>
                Nothing is claimable on-chain yet — Phase 4 wires the claim contract. Until then,
                playing is free, and every coin you bank counts toward your place in line.
              </p>
            </div>
          </div>
        </section>

        <section className="band shell" id="roadmap">
          <div className="section-head">
            <span className="pill">Roadmap</span>
            <h2>Where the ice is heading</h2>
          </div>
          <div className="roadmap">
            {ROADMAP.map((r) => (
              <article className={`card phase${r.done ? ' done' : ''}`} key={r.phase}>
                <b>{r.phase}</b>
                <ul>
                  {r.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="band shell">
          <div className="card cta-band">
            <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', marginBottom: 14 }}>
              The ice is open. Bring your penguin.
            </h2>
            <p style={{ maxWidth: '52ch', margin: '0 auto 28px' }}>
              {stats.online > 0
                ? `${stats.online} penguin${stats.online === 1 ? '' : 's'} waddling right now.`
                : 'Be the first one out on the ice today.'}
            </p>
            <button className="btn btn-play" onClick={play} disabled={restoring}>
              ▶ PLAY
            </button>
          </div>
        </section>
      </main>

      <footer className="shell footer">
        <div className="brand" style={{ fontSize: '1.05rem' }}>
          <img src="/poglogo.jpg" alt="" style={{ width: 28, height: 28 }} />
          <span>$POG</span>
        </div>
        <div className="footer-links">
          <a href="https://x.com" target="_blank" rel="noreferrer noopener">
            X / Twitter
          </a>
          <a href="https://t.me" target="_blank" rel="noreferrer noopener">
            Telegram
          </a>
          <a href="https://dexscreener.com" target="_blank" rel="noreferrer noopener">
            DexScreener
          </a>
          <a href="https://github.com/cryko98/pog" target="_blank" rel="noreferrer noopener">
            GitHub
          </a>
        </div>
      </footer>

      <p className="disclaimer">
        $POG is a memecoin created for entertainment. It has no intrinsic value, no expectation of
        financial return, and no formal team or roadmap obligation. In-game $POG points are not a
        security and are not redeemable today. Nothing here is financial advice — never spend more
        than you can afford to lose.
      </p>

      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
      {profileMode && (
        <ProfileModal
          required={profileMode === 'setup' && !profile?.name}
          onClose={() => setProfileMode(null)}
          onSaved={() => profileMode === 'setup' && navigate('play')}
        />
      )}
    </div>
  );
}
