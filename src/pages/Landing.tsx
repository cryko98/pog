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
    body: 'Fifteen swings to fell a pine with bare flippers, five once the workbench has made you an axe; an ice pick saws a block of ice in three. Tools wear out and the workbench makes more. Fishing is patience: cast, wait five seconds for the bite, cast again — six species from Arctic smelt to the Frost King, rolled by rarity, and sometimes it gets away. Every catch and every felling is a point of skill, and higher levels haul more.',
  },
  {
    icon: 'igloo' as IconName,
    title: 'Build it, then furnish it',
    body: 'Spend 300 wood and 120 ice on an igloo and raise it wherever the snow is clear. Step inside, and anything from the furnishing stall goes wherever you put it. Furniture is worth value; value earns a level — Shelter, Den, Lodge, Hall, Palace — and from Den up the igloo pays a few P coins a day — and a furnished igloo takes a slice of every day’s airdrop while you play.',
  },
  {
    icon: 'coin' as IconName,
    title: 'Sell the whole thing',
    body: 'The igloo market sells the plot, the level and everything inside in one go — for P coins, or for the real $POG token once it is live, paid wallet to wallet with 8% burned on chain. The game never holds a key or a coin.',
  },
  {
    icon: 'snowflake' as IconName,
    title: 'The snowball arena',
    body: 'Off the plaza, past the lanterns: two penguins face off across a rink, a stake each, winner takes the pot. Real time — throw straight balls and lobs, jump the straight ones, step out from under the lobs, first to five hits. Stake wood, ice, fish or P coins — or the real $POG token once it is live, paid into the airdrop wallet and paid back out of it: the winner gets both stakes, never more than came in. Every move is stamped by the server as it arrives and the fight is replayed from that log, so nobody can claim a hit or dodge after the fact.',
  },
  {
    icon: 'coin' as IconName,
    title: 'The bear caves',
    body: 'Far the other way, past the last lantern, a black mouth in a hill. Inside: a corridor of ice, polar bears coming at you — more, faster and tougher with every wave — and P coins for every one you put down with snowballs. Three hearts, and a swipe cannot reach a penguin in the air. Walk out when no bear is close and the coins are yours. Get eaten and everything in your pack is gone — so put things away in your igloo first.',
  },
  {
    icon: 'dice' as IconName,
    title: 'A market and a casino',
    body: 'The market house trades wood, ice and fish between players for P coins, with 5% of every sale burned. The casino tent takes P coins on a snowflake flip, ice dice or a bear race — three white bears, each running its own race on the roll’s bytes — the house wins more hands than it loses, and every roll is provably fair: the server commits to the day’s seed before you bet, you add a seed of your own, and yesterday’s seed is published so any hand can be checked.',
  },
  {
    icon: 'quest' as IconName,
    title: 'A reason to come back tomorrow',
    body: 'Three quests a day, drawn from your own wallet address so nobody can reroll into easy ones. Clear all three and the streak bonus grows — miss a day and it starts over. And a raw fish is worth nothing until you smoke five over the plaza fire for P coins.',
  },
  {
    icon: 'snowflake' as IconName,
    title: 'Two currencies, two jobs',
    body: 'P coins are the in-game money: found on the ice, paid by the cookout and the quests, they buy hats, furniture and other people’s igloos, and nothing they buy makes you gather faster. They are not the $POG token. Frost is your score toward the airdrop — earned by quests, playtime, your igloo and offerings at the season cairn, never spendable, never reduced — and every day the airdrop wallet pays out by share: your Frost that day over everyone’s.',
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
    body: 'Phantom, Solflare, Backpack — any Solana wallet, one signature to log in and never a transaction unless you choose to — buy an igloo or stake an arena match for real $POG. Airdrop payouts arrive on their own. Or skip it and play as a guest.',
  },
  {
    title: 'Name your penguin',
    body: 'Username and scarf colour, saved to your wallet so they follow you to any device.',
  },
  {
    title: 'Work the ice',
    body: 'Walk up to a pine or a block of ice and hold E — or the round button, on a phone — to swing; press it at a fishing hole to cast, stay put for the bite, and cast again. WASD to move, Shift to sprint, and the frozen lakes are fast but slippery.',
  },
  {
    title: 'Craft, cook, build, furnish',
    body: 'Six named shops ring the plaza: the workbench turns wood into an axe, an ice pick, a rod and, after a season of logging, an igloo kit; the cookout turns fish into P coins; the furnishing stall fills the igloo; the market trades goods and sells igloos. Further out: the snowball arena, the casino tent and the bear caves. Raise the igloo on clear snow and you will wake up at its door from then on.',
  },
];

const TOKENOMICS = [
  ['Ticker', '$POG'],
  ['Network', 'Solana (SPL)'],
  ['Total supply', '1,000,000,000'],
  ['Buy / sell tax', '0% / 0%'],
  ['LP', 'Burned at launch'],
  ['Mint & freeze authority', 'Revoked'],
  ['Play-to-earn wallet', '50,000,000 $POG'],
  ['Paid out', '0.2% of the wallet, every day'],
];

const ROADMAP = [
  {
    phase: 'Phase 1 — Ice break',
    done: true,
    items: [
      'Wallet login & guest play',
      'Spawn plaza, shared world, live chat',
      'Username bound to wallet',
      'P coin pickups & leaderboard',
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
      'The plaza cookout: fish into P coins',
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
      'The igloo market — P coins or real $POG',
      'The snowball arena — duels for stakes',
      'The bear caves, and a store in every igloo',
      'The goods market and the casino',
      'Daily airdrop payouts from the 50M wallet',
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
            <a
              className="btn btn-ghost btn-sm nav-x"
              href="https://x.com/playpogonsol"
              target="_blank"
              rel="noreferrer noopener"
              title="$POG on X"
              aria-label="$POG on X"
            >
              <Icon name="x" size={15} />
            </a>
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
              🐧 POG is
              <br />
              <em>back!</em>
            </h1>
            <p className="lead">
              POG was born in 2024 and quickly became one of the biggest cults on Solana.
            </p>
            <p className="lead">Now we're back — same team, same devs, same POG energy.</p>
            <p className="lead">
              A play-to-earn multiplayer open world where your inventory actually pays.
            </p>
            <p className="lead">
              Explore a frozen world, farm loot, battle other penguins and NPCs, complete challenges,
              and compete for valuable supplies.
            </p>
            <p className="lead">
              <strong>Stake your igloo. Build your inventory. Take on the world.</strong>
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
                ? 'You are exploring as a guest. Connect a wallet to keep your name and start earning P coins.'
                : 'No wallet? Jump straight in as a guest — you can roam and chat, but P coins are only credited to a wallet.'}
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
              <h3 style={{ marginBottom: 12 }}>Play to earn, paid daily</h3>
              <p>
                Two currencies, two jobs. <strong>P coins</strong> are the in-game money — found on the ice,
                cooked at the fire, paid out by quests and by a furnished igloo — and it buys hats,
                furniture and other players’ igloos, and they are not the $POG token. <strong>Frost</strong> is the airdrop ledger:
                it is never spendable, never goes down, and is the only thing the season pays out
                against. Nothing you can buy, sell or own moves Frost.
              </p>
              <p style={{ marginTop: 14 }}>
                The <strong>igloo market</strong> is where real value enters. An igloo sells with its
                level and everything inside, for P coins today and for the real $POG token once it
                is live. Real sales settle wallet to wallet: the buyer pays the seller directly and
                burns 8% in the same transaction, the game reads the finalised transaction back from
                the chain before the igloo changes hands, and it never holds a key or a coin.
              </p>
              <p style={{ marginTop: 14 }}>
                <strong>50,000,000 $POG</strong> sit in one airdrop wallet, and every UTC day it pays
                out <strong>0.2% of whatever it still holds</strong> — 100,000 $POG on day one, shrinking
                as the wallet does and never quite running out: about half of it is paid in the first
                year, half of the rest in the second. 80% of each day's budget is split among that
                day's players <strong>by the Frost they banked that day</strong>, 20% among their
                furnished igloos by value. By share, not at a rate:{' '}
                <code>your Frost today ÷ everyone's × the day's budget</code>. That is the only promise
                that can be kept — and it means a busy day pays everyone a little less, never nothing.
              </p>
              <p style={{ marginTop: 14 }}>
                Payouts are sent to your wallet automatically, in whole tokens, the next time you
                play; anything under a token carries over. Every closed day is recorded — budget,
                Frost, wallets, paid — so the maths can be checked.
              </p>
              <p style={{ marginTop: 14 }}>
                A wallet earns nothing until it qualifies: an hour of server-counted playtime, a
                captcha, and a minimum on-chain balance once the token is live. Multipliers stack on
                a capped daily base and every one of them rewards depth — the holder tiers are
                absolute, so a bag split across ten wallets puts all ten in a lower tier than the
                same bag held in one.
              </p>
              <p style={{ marginTop: 14 }}>
                <strong>Until the token is live</strong> the wallet runs as a ledger: days close, shares
                are recorded and owed, and they are sent the moment the wallet is funded and the key
                is in place.
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
          <a href="https://x.com/playpogonsol" target="_blank" rel="noreferrer noopener" className="with-icon">
            <Icon name="x" size={14} /> @playpogonsol
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
        financial return, and no formal team or roadmap obligation. In-game P coins are not a
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
