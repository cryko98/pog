import { useEffect, useState } from 'react';
import type { Route } from '../App';
import { useSession } from '../state/session';
import { shortAddress } from '../lib/wallet';
import { api } from '../lib/api';
import { PenguinMark } from '../components/PenguinMark';
import { WalletModal } from '../components/WalletModal';
import { ProfileModal } from '../components/ProfileModal';
import { Icon, type IconName } from '../components/Icon';

const CONTRACT = import.meta.env.VITE_POG_CONTRACT ?? 'TBA — dropping at launch';

const FEATURES = [
  {
    icon: 'world' as IconName,
    title: 'One frozen open world',
    body: 'A 6.4 × 6.4 km snowfield of pine forest, frozen lakes and lantern-lit plaza — no lobbies, no instances. Everyone waddles the same map, and the trees you fell stay felled for everyone.',
  },
  {
    icon: 'wood' as IconName,
    title: 'Chop, cut, fish',
    body: 'Five swings to fell a pine, three to saw a block of ice, three to land a fish. Craft a rod at the workbench, then the kit for your own igloo. Nothing here is a single click.',
  },
  {
    icon: 'igloo' as IconName,
    title: 'Build something that lasts',
    body: 'Spend 300 wood and 120 ice on an igloo and raise it wherever the snow is clear. It carries your name and every other player sees it — the only part of the world players author.',
  },
  {
    icon: 'players' as IconName,
    title: 'Real multiplayer, no wallet needed',
    body: 'Everyone online shares one map in real time. Jump in as a guest to roam, slide and chat; connect a wallet when you want what you do to count.',
  },
  {
    icon: 'coin' as IconName,
    title: '$POG buys looks, not power',
    body: 'Coins are deliberately scarce and the shop only sells hats. Nothing you can buy makes you gather faster — the real economy is wood, ice and fish.',
  },
  {
    icon: 'lock' as IconName,
    title: 'Hard to cheat, on purpose',
    body: 'Every action is checked against where you last stood and how long ago. A bot has to walk the map and swing the axe exactly as often as you do.',
  },
];

const STEPS = [
  {
    title: 'Connect or guest',
    body: 'Phantom, Solflare, Backpack — any Solana wallet, one signature, never a transaction. Or skip it and play as a guest.',
  },
  {
    title: 'Name your penguin',
    body: 'Username and scarf colour, saved to your wallet so they follow you to any device.',
  },
  {
    title: 'Work the ice',
    body: 'Walk up to a pine, a block of ice or a fishing hole and hold E. WASD to move, Shift to sprint — and the frozen lakes are fast but slippery.',
  },
  {
    title: 'Craft, then build',
    body: 'The workbench on the plaza turns wood into a rod and a season of logging into an igloo kit. Place the igloo on clear snow and it is yours for good.',
  },
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
    items: [
      'Wallet login & guest play',
      'Spawn plaza, shared world, live chat',
      'Username bound to wallet',
      '$POG pickups & leaderboard',
    ],
  },
  {
    phase: 'Phase 2 — Waddle',
    done: true,
    items: [
      'Wood, ice and fishing',
      'Workbench & market stall',
      'Player-built igloos',
      'Hats in the shop',
    ],
  },
  {
    phase: 'Phase 3 — Blizzard',
    items: [
      'Igloo furniture & interiors',
      'Igloo marketplace',
      'Snowball PvP arena',
      'Guilds and daily quests',
    ],
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
  const [stats, setStats] = useState({ online: 0, wallets: 0, coins: 0 });
  const [igloos, setIgloos] = useState(0);
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
    // igloos are public, and a growing count is the best proof the world
    // is being lived in
    const pullIgloos = () =>
      api
        .igloos()
        .then((r) => alive && setIgloos(r.igloos.length))
        .catch(() => {});

    pull();
    pullIgloos();
    const timer = setInterval(() => {
      pull();
      pullIgloos();
    }, 10_000);
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
          <Icon name="warning" size={15} /> The $POG API is not responding, so wallet login is
          unavailable right now.
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
                <Icon name={identity.guest ? 'guest' : 'penguin'} size={15} /> {identity.name}
              </button>
            )}
            {status === 'ready' ? (
              <button className="btn btn-ghost btn-sm" onClick={logout} title="Disconnect">
                <Icon name="power" size={15} label="Disconnect" />
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
              $POG is the coldest memecoin on Solana — and the only one with a survival game behind
              it. Fell pines, saw ice out of the lakes, fish the holes, and spend a hard-won haul on
              an igloo that everybody else can see. No wallet needed to look around.
            </p>

            <div className="hero-cta">
              <button className="btn btn-play" onClick={play} disabled={restoring}>
                <Icon name="play" size={20} /> PLAY
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
                <b>{igloos}</b>
                <span>Igloos built</span>
              </div>
              <div className="stat">
                <b>{stats.coins}</b>
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
              No roadmap promises of a game "coming soon". Open the site and you are standing in it —
              a tilted top-down snowfield rendered live in your browser, with an economy that makes
              you work for everything in it.
            </p>
          </div>
          <div className="grid grid-3">
            {FEATURES.map((f) => (
              <article className="card feature" key={f.title}>
                <div className="ico">
                  <Icon name={f.icon} size={24} />
                </div>
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
                Every $POG coin you pick up is recorded against your wallet and shown on the live
                leaderboard. In game, coins buy hats and nothing else — they never make you gather
                faster, so nobody can spend their way up the board.
              </p>
              <p style={{ marginTop: 14 }}>
                Those balances are the ledger for future on-chain reward distributions from the
                community treasury. <strong>Nothing is claimable on chain yet</strong> — Phase 4
                wires the claim contract. Until then, playing is free and every coin you bank counts
                toward your place in line.
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
              <Icon name="play" size={20} /> PLAY
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
