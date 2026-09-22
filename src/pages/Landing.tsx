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
    body: 'A 6.4 × 6.4 km snowfield of pine forest, frozen lakes and a lantern-lit plaza — no lobbies, no instances. Everyone online waddles the same map in real time, and the trees you fell stay felled for everyone. Jump in as a guest to roam, slide and chat; connect a wallet when you want what you do to count.',
  },
  {
    icon: 'wood' as IconName,
    title: 'Chop, cut, fish — and get better at it',
    body: 'Five swings to fell a pine, three to saw a block of ice. Fishing is patience: cast once and a bite comes every five seconds — six species from Arctic smelt to the Frost King, rolled by rarity, and sometimes it gets away. Every catch and every felling is a point of skill, and higher levels haul more.',
  },
  {
    icon: 'igloo' as IconName,
    title: 'Build it, then furnish it',
    body: 'Spend 300 wood and 120 ice on an igloo and raise it wherever the snow is clear. Step inside, and anything from the furnishing stall goes wherever you put it. Furniture is worth value; value earns a level — Shelter, Den, Lodge, Hall, Palace — and from Den up the igloo pays a little $POG a day.',
  },
  {
    icon: 'coin' as IconName,
    title: 'Sell the whole thing',
    body: 'The igloo market sells the plot, the level and everything inside in one go — for in-game $POG, or for the real token once it is live, paid wallet to wallet with 8% burned on chain. The game never holds a key or a coin.',
  },
  {
    icon: 'snowflake' as IconName,
    title: 'The snowball arena',
    body: 'Off the plaza, past the lanterns: two penguins, a stake each, winner takes the pot. Ten volleys — throw at a lane, high or low, and pick where to stand and whether to jump, both sealed before either is shown. Stake wood, ice, fish or $POG, or the real token into the arena pool once it is live. The server scores every hit from the sealed choices, so nobody can claim one.',
  },
  {
    icon: 'quest' as IconName,
    title: 'A reason to come back tomorrow',
    body: 'Three quests a day, drawn from your own wallet address so nobody can reroll into easy ones. Clear all three and the streak bonus grows — miss a day and it starts over. And a raw fish is worth nothing until you smoke five over the plaza fire for $POG.',
  },
  {
    icon: 'snowflake' as IconName,
    title: 'Two currencies, two jobs',
    body: '$POG is the soft one: it buys hats, furniture and other people’s igloos, and nothing it buys makes you gather faster. Frost is the airdrop ledger — earned by quests, playtime, your igloo and offerings at the season cairn, never spendable, never reduced — and at the end of the season a fixed budget is split by share: your Frost over everyone’s.',
  },
  {
    icon: 'lock' as IconName,
    title: 'Hard to cheat, on purpose',
    body: 'Every action is checked against where you last stood and how long ago, and every wallet has one writer at a time, so firing two requests at once buys nothing. Frost has no endpoint that credits it, a wallet earns nothing until it qualifies, and the holder tiers make one deep wallet beat three shallow ones.',
  },
];

const STEPS = [
  {
    title: 'Connect or guest',
    body: 'Phantom, Solflare, Backpack — any Solana wallet, one signature to log in and never a transaction unless you choose to buy an igloo for real $POG. Or skip it and play as a guest.',
  },
  {
    title: 'Name your penguin',
    body: 'Username and scarf colour, saved to your wallet so they follow you to any device.',
  },
  {
    title: 'Work the ice',
    body: 'Walk up to a pine or a block of ice and hold E — or the round button, on a phone — to swing; press it once at a fishing hole to cast and stay put. WASD to move, Shift to sprint, and the frozen lakes are fast but slippery.',
  },
  {
    title: 'Craft, cook, build, furnish',
    body: 'Six named shops ring the plaza: the workbench turns wood into a rod and a season of logging into an igloo kit; the cookout turns fish into $POG; the furnishing stall fills the igloo; the market sells it. Raise the igloo on clear snow and you will wake up at its door from then on.',
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
    phase: 'Phase 3 — Deep winter',
    done: true,
    items: [
      'Daily quests & streaks',
      'The plaza cookout: fish into $POG',
      'Respawn at your own igloo',
      'Playable on a phone',
    ],
  },
  {
    phase: 'Phase 4 — The season',
    done: true,
    items: [
      'Frost: the airdrop ledger',
      'Qualifying gate & holder tiers',
      'The cairn and offerings',
      'Snapshot & audit tooling',
    ],
  },
  {
    phase: 'Phase 5 — Blizzard',
    done: true,
    items: [
      'Igloo furniture, interiors & levels',
      'Skills: fish, chop and cut better',
      'The igloo market — in-game or real $POG',
      'The snowball arena — duels for stakes',
    ],
  },
  {
    phase: 'Phase 6 — Glacier',
    items: ['Guilds', 'The claim contract', 'NFT penguin skins', 'Seasonal tournaments'],
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
          <div className="nav-actions">
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
              an igloo that everybody else can see — then furnish it, level it, and sell it on the
              market. No wallet needed to look around.
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
          <div className="grid grid-4">
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
                Two currencies, two jobs. <strong>$POG</strong> is the soft one — found on the ice,
                cooked at the fire, paid out by quests and by a furnished igloo — and it buys hats,
                furniture and other players’ igloos. <strong>Frost</strong> is the airdrop ledger:
                it is never spendable, never goes down, and is the only thing the season pays out
                against. Nothing you can buy, sell or own moves Frost.
              </p>
              <p style={{ marginTop: 14 }}>
                The <strong>igloo market</strong> is where real value enters. An igloo sells with its
                level and everything inside, for in-game $POG today and for the real token once it
                is live. Real sales settle wallet to wallet: the buyer pays the seller directly and
                burns 8% in the same transaction, the game reads the finalised transaction back from
                the chain before the igloo changes hands, and it never holds a key or a coin.
              </p>
              <p style={{ marginTop: 14 }}>
                The season budget is split <strong>by share</strong>, not at a fixed rate:{' '}
                <code>your Frost ÷ all Frost × the budget</code>. That is the only promise that can
                actually be kept — a fixed rate against a game that mints points forever cannot be.
              </p>
              <p style={{ marginTop: 14 }}>
                A wallet earns nothing until it qualifies: an hour of server-counted playtime, a
                captcha, and a minimum on-chain balance once the token is live. Multipliers stack on
                a capped daily base and every one of them rewards depth — the holder tiers are
                absolute, so a bag split across ten wallets puts all ten in a lower tier than the
                same bag held in one.
              </p>
              <p style={{ marginTop: 14 }}>
                <strong>Nothing is claimable on chain yet.</strong> The ledger, the caps and the
                snapshot tooling are built and running; the distributor contract is Phase 6. Every
                season ends with a published snapshot — wallet, Frost, share, tokens — so the maths
                can be checked by anyone.
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
