# $POG — Frozen Open World

A winter open-world multiplayer play-to-earn browser game for the **$POG** Solana memecoin.
Connect a Solana wallet, name your penguin, and spawn onto a shared snowfield with everyone
else who is online.

Deploys to Vercel as a static site plus a handful of serverless functions — there is no
game server to keep alive.

## What's in here

| | |
|---|---|
| **Landing page** | Hero, feature grid, how-to-play, tokenomics, roadmap, and a big **PLAY** button. |
| **Wallet login** | Wallet Standard (Phantom, Solflare, Backpack, Glow…). One free off-chain signature — never a transaction. |
| **Username** | Bound to the wallet address, unique across players, editable any time. Scarf colour too. |
| **The world** | 6400 × 6400 units of pine forest, frozen lakes and lantern-lit plazas, generated deterministically from one seed. Shelters are deliberately absent — players will build those. |
| **Multiplayer** | Everyone shares one map over a public MQTT broker — positions, chat and name tags in real time. |
| **Survival loop** | Chop wood — fifteen swings a pine by hand, five with an axe — cut ice with a pick, fish with a rod. Tools come from the workbench and wear out. Then an igloo kit, then raise the igloo — all validated server-side. |
| **Daily quests** | Three a day, derived from your wallet address and the UTC date. Clear all three and a streak bonus stacks on top. |
| **Play to earn** | A few dozen scarce P coins on the ice — none near the plaza, and well apart — the plaza cookout, and quest rewards. P coins are the in-game money, not the $POG token; the token only ever moves wallet to wallet. Balances are banked per wallet on a live leaderboard. |
| **The season** | **Frost**, a separate ledger that only goes up. A fixed token budget is split by share at the end of each season. Gated, capped, and snapshot to a merkle root. |
| **Phone support** | An on-screen action button next to the virtual stick, so gathering, the stations and building all work without a keyboard. |
| **Onboarding** | A card that says the one thing to do next — move, fell a pine, gather 25 wood, craft a rod, catch a fish, cook it — with an arrow on the ice to where. Judged from the pack, not from clicks, so it cannot get stuck; goes away for good once the loop has been walked once, or when skipped. |
| **Sound** | Every effect and the music are synthesised with the Web Audio API (`src/game/audio.ts`) — an axe biting, ice shattering, a cast and a splash, coins, the workbench, doors, snowballs — over a bright chiptune loop (square lead, triangle bass, kick, snare, hat) that plays faster in the arena. No audio files; two switches, remembered per browser. |

Every visual is drawn procedurally with Canvas 2D — the penguin, the trees, the ice, the
coins. No sprite sheets to ship and no third-party art licences to track.

## The loop

Chop pines for **wood**, saw blocks of **ice** out on the lakes, and fish the
holes once you have a rod. Crafting happens at the workbench on the spawn
plaza; the stall next to it sells hats, and the fire between the snowmen is
where a catch becomes currency.

```
25 wood              ->  fishing rod  ->  fish the holes
300 wood + 120 ice   ->  igloo kit    ->  raise your own igloo
5 fish   -> 1 P coin |   30 fish -> 7 P coins  (the plaza fire)
```

A raw fish has no other use, which is the point: the rod is what turns a
pile of wood into an income, and the fire is the only way to earn coins by
working rather than by stumbling across them.

Once your igloo is standing you wake up at its door instead of back on the
plaza. That is most of what 300 wood buys you.

Nothing gives way in one press. A pine takes **five swings**, ice three,
and a fish three — counted on the server, one per request, so a bot has to
swing as often as you do. Hold E to keep swinging; pips over the node show
how far through you are.

The rates are deliberately unkind on top of that. A tree gives 2 wood and
takes five minutes to grow back, ice takes four, and no wallet may bank
more than 12 of any resource per minute. An igloo is therefore about
twenty minutes of real work — a session goal, not a click.

Placement is a mode, not a button: you carry a translucent igloo and the
ground reads green or red as you walk, with the reason stated. Client and
API run the same `canBuildAt`, so the preview never lies.

Igloos are the one part of the world players author. Build one on clear snow
and it is stored against your wallet, carries your name, and every other
player sees it from then on.

## Daily quests

Three a day, and you do not get to pick them: they are drawn deterministically
from your wallet address and the UTC date, so logging out and back in gives you
the same three. The server recomputes them from scratch on every request rather
than trusting a list the client sends.

Progress is only ever incremented from inside `gather`, `craft` and `claimCoin`,
which means it inherits every rate cap those already enforce — there is no
endpoint that takes "I did the thing" as input. Rewards are gated on an atomic
`setnx` per quest, so two racing claims pay out exactly once.

Clearing all three extends a streak, worth an extra $POG per consecutive day up
to five. Miss a day and it starts over.

**$POG is cosmetic only.** Coins are scarce — a few dozen on the whole map with a
four-minute respawn — and the only thing they buy is a hat in the shop.
Nothing purchasable makes you gather faster; the real economy is wood, ice
and fish. The cookout and the quest board add two more ways in, both bounded
by the same gathering caps: a wallet gets one bite every five seconds (a server-held
clock, whatever the client sends), each bite is one server-side roll on the fish
table in `shared/world.js` — six species by rarity, or nothing at all — and the 21
fishing holes can only produce so much fish
per minute no matter how many players work them.

Guests can walk, slide and chat, but nothing they do is recorded: $POG is
credited to a wallet address, and a guest has none.

## Igloos, furniture and the market

Furnishings are bought at the stall on the plaza for $POG, carried in the
backpack, and placed anywhere inside your own igloo. Each piece is worth
*value*; the igloo's level is derived from the total and never stored, so
tuning the table never leaves a stale number behind. Higher levels pay a
small daily $POG yield — soft $POG, never Frost — settled when you play,
capped at three days so it is a reason to come back rather than a reason to
leave the tab open.

The **igloo market** sells the whole thing at once: the plot, the level and
everything inside. Two kinds of listing:

| | **In-game $POG** | **Real $POG** (once `POG_MINT` is set) |
|---|---|---|
| Settles | in the API, from balance to balance | on chain, wallet to wallet |
| The house cut | 8%, burned | 8%, **burned on chain by the buyer** in the same transaction |
| Who can trade | both sides must have qualified for the season | same |
| Who holds the money | nobody — it moves at once | nobody — the server has no keys and escrows nothing |

The on-chain sale is built so that the server never has to be trusted with
a token and the client never has to be trusted about a payment:

1. The buyer **reserves** the listing for ten minutes. While it is reserved
   the seller cannot unlist, move, or take anything out — the buyer is paying
   for the igloo they looked at — and nobody else can reserve it.
2. The server **builds** the payment as an unsigned transaction: transfer the
   take-home to the seller, burn the cut, and a memo naming *this* listing.
   The buyer's wallet shows exactly that before asking for approval.
3. The buyer signs and sends it. Their wallet returns the signature.
4. The server **reads the transaction back from the chain** at finalized
   commitment and checks it against the sale (`shared/sale.js`): it succeeded,
   the buyer signed it, the memo names this listing, the seller's balance of
   the mint rose by the take-home, the cut was burned by the buyer, and the
   signature has never settled a sale before. Only then does the igloo move.

Nothing about the transaction is taken from the request but its signature.
`salecheck.mjs` runs the verifier against an honest payment and sixteen
dishonest variations of it, which is the only way it can be tested before
the token exists.

## The snowball arena

Off the plaza, past the lanterns. Two penguins face off across a rink, a stake
each, winner takes the pot. Real time, side on: move with A/D, jump with W,
throw a straight ball with J and a lob with K. A straight ball flies at chest
height and is dodged by jumping; a lob comes down where it was aimed and is
dodged by stepping out from under it. A hit stuns you for a moment. Throws are
spaced further apart than a jump's cooldown, so a stream of straight balls can
always be jumped by a player who reads them — the fight is won by mixing. First
to five hits, or the most when sixty seconds run out; level, and it is overtime
until the next hit.

**How a real-time fight stays honest without a game server.** Presence is
peer-to-peer and unauthenticated, so a client is never asked where it is or
what it hit. It sends what the player *did* — move, jump, throw — and the API
stamps each input with its own clock the moment it arrives. The match is then
a pure function of that log: `simulate(inputs, startAt, until)` in
`shared/fight.js` steps a fixed-rate world forward and applies every input at
its server time. The clients run that function for the picture, the server
runs it for the score. A jump that reached the server after the ball crossed
you is a jump after the ball crossed you, whatever the client's clock said.
Nothing about position or hits is ever taken from a request; inputs are capped
per second so a script gets the same hand a human has.

For the picture, the opponent's inputs also travel over the broker — a
fraction of a request's round trip — and are drawn provisionally until the
server's stamped copies replace them within a poll. A forged broker message
could nudge your screen for a moment; it cannot touch the result.

**Stakes are escrowed before the first throw.** A soft stake (wood, ice, fish,
$POG) leaves the host's pack when the challenge goes up and the challenger's
when it is taken; the winner gets both, with 5% of any $POG burned. A stake is
refused if winning it would overfill the winner's playtime-bound pack, so the
arena cannot launder resources past the cap. A real-token stake is paid by each
side into the **airdrop wallet** (`POG_AIRDROP_WALLET`, or a separate
`POG_ARENA_POOL` if one is set) on chain, with a memo
naming the match and the player, and verified at finalized commitment the same
way an igloo sale is. Nothing starts until both are in; if one side never pays,
the other is refunded.

**Paying the winner.** With the wallet's key set (`POG_AIRDROP_KEYPAIR`, or
`POG_ARENA_POOL_KEYPAIR` for a separate pool), it signs the payout the moment
the match ends — both verified deposits to the winner, each side its own on a
draw, never more than came in. Without the key,
payouts queue in Redis (`pog:payouts`) and the operator sends them from a
keypair file with `tools/payout.mjs`, dry run by default — the same shape as
`send.mjs`. Either way every payout is created only by a settled match, for the
verified deposit amounts, to the verified winner; nothing takes an amount or a
recipient from a request.

**What a cheat cannot do**, and `arenacheck` proves: backdate a jump, put a
position or a hit count in a request and have it applied, flood inputs, act
during the countdown or after the end, act in a match they are not in, take
their own challenge, take one twice, put up a stake they do not hold, act from
anywhere but the arena, or keep playing once it is over.

## The bear caves

Far the other side of the plaza from the arena, past the last lantern: a hill
with a black mouth in it. A run is a side-on corridor of ice with polar bears
coming the other way. Move with A/D, jump with W, throw with J — the way you
face. You carry six snowballs and pack more only while standing still on the
ground, and only once you have stopped throwing for a beat; so you cannot
throw forever, and the moment you stop to pack, the bears close in. A bear
blocks the floor but not the air: a well-timed jump carries you over it, after
which it turns round and comes after you, with a beat's delay. A swipe is
telegraphed — a "!" and the paw comes up, then lands — so a jump on the
wind-up clears it. Bears take two snowballs at first and one more with every
wave; they come faster and more at once. Three hearts, a swipe takes one.
Leaving means being back at the mouth with no bear on your heels.

**The bet is the pack.** Walk out (or wait for the cave to close after three
minutes) and the coins are in your pack. Get eaten and the run's coins *and
everything in the pack* — wood, ice, fish, P coins, tools, furniture in the
bag — is gone. Which is what the igloo's **store** is for: standing at
your own igloo, anything in the pack can be put away and taken back out. Pack
and store share the same hold cap, so the store is a safe place rather than a
bigger pack; a listed igloo is frozen, because a buyer is paying for what is
in it.

The run is honest the same way the arena is. The client sends keys — move,
jump, throw, leave — the server stamps each on arrival, and the run is a
pure function of that log and a seed the server chose when the run began
(`shared/dungeon.js`). It is replayed whenever the run is read and settled
exactly once, under the wallet lock. Nothing about kills, hearts or coins is
ever taken from a request; `cavecheck.mjs` tries. Frost, skins and the
igloo's store are never touched by the caves.

## The goods market and the casino

**The market house** trades wood, ice and fish between players for
P coins. A lot leaves the seller's pack the moment it goes up and comes back
if it is taken down; a buyer pays per unit for as much of a lot as they
want; 5% of every sale is burned. Both sides must have qualified for the
season — a bazaar is the natural laundering route for a farm of shallow
wallets feeding one deep one — and both must be standing at the market
house. Every write runs under both wallets' locks, so two buyers racing for
the last unit cannot both get it.

**The casino tent**, out on the arena side, takes P coins — never the token
— on three tables, and every table wins fewer hands than it loses. The
snowflake flip is ice or fire, but 8% of the time the flake *melts* and beats
both calls (46% to win, pays 2×). The ice dice take a number from 2 to 48;
the roll is 0–99 and under wins (pays 92/pick). The bear race is a real race:
each of three polar bears gets its own pace for each of eight legs, every
pace a byte of the roll's digest, and the first over the line wins (a third
each, pays 2.76×) — the client animates exactly those paces, so what you
watch is what won. The house keeps 8% of the fair odds and burns it. Every
roll is **provably fair**: each UTC day the server draws a secret seed and
publishes only its SHA-256; a bet's roll is
`HMAC-SHA256(seed, wallet:day:nonce:clientSeed)` where the nonce counts the
wallet's bets that day and the client seed is the player's own; yesterday's
seed is public at `/api/casino/reveal?day=`, so any past hand can be
recomputed. The wager is taken and the win paid in one step under the wallet
lock; a bet cannot bring its own result, and `marketcheck.mjs` tries.

## The season, and the airdrop

Two currencies, because they have two different jobs.

| | **P coins** | **Frost** |
|---|---|---|
| What it is | the in-game money (not the $POG token) | the airdrop ledger |
| Spendable | yes — hats, furniture, igloos, the market, the tables | **never** |
| Can go down | yes | no |
| Where it comes from | coins, the cookout, quest rewards, the caves | quests, playtime, your igloo, the cairn |
| What it is worth | what it buys | a share of every day's airdrop budget, paid daily |

### The daily airdrop

One wallet holds the play-to-earn allocation — **50,000,000 $POG** — and every
UTC day it pays out **0.2% of whatever it still holds**. Not a fixed number of
tokens: the budget is biggest at launch (100,000 $POG on day one), shrinks as
the wallet does, and never quite runs out — about half is paid in the first
year, half of the rest in the second, and with the 5,000-a-day floor the wallet
lasts around five and a half years. More players do not drain it faster; they
split the same day's budget into more, smaller shares. A ceiling of 250,000 a
day stops a topped-up wallet paying a fortune in one go.

Each day's budget is split two ways, both **by share**:

| Slice | Split among | By |
|---|---|---|
| 80% | every wallet that banked Frost that day | the Frost it banked **that day** (capped and multiplied, so performance rather than hours) |
| 20% | those same wallets' igloos | furnished igloo value — an igloo nobody plays from earns nothing |

```
your tokens today = your Frost today / everyone's Frost today * 80% of the budget
                  + your igloo value / all active igloo value * 20% of the budget
```

By share, not at a rate. A rate — "1 Frost = N tokens" — cannot be honoured,
because the game mints Frost for as long as anyone plays and the wallet is
finite. A share always adds up to exactly the day's budget, however many
people played. The rules are `shared/airdrop.js`; the closing and paying are
`src/server/airdrop.ts`.

**How a day closes.** Every Frost credit also lands in that day's index
(`pog:fday:<day>`) from inside the same validated action that banked it. Once
the day is over, the first request to notice — or the cron at 00:07 UTC —
closes it under a global lock: budget, split, and each wallet's amount added
to what it is owed. A closed day is recorded (`/api/season/days`) with its
budget, Frost pool, wallet count and total paid, so the maths can be checked,
and it can never be closed twice. Whole tokens only; anything under a token
carries over to the next day.

**How it is paid.** Lazily, per wallet: the next time a wallet loads the game
or reads its season status, what it is owed is sent from the airdrop wallet
under that wallet's lock and the signature is kept. That spreads the sending
over the day instead of needing one long job, and a wallet that never comes
back is never paid — the tokens stay in the wallet and go into later budgets.
The panel also has a Collect button. With no key in the environment the
amounts simply stay owed — nothing is lost — and go out on each wallet's next
visit once the key is set.

A send is held as **pending** until the chain shows it finalized: confirmed,
it becomes history; failed on chain, or unseen for five minutes (a blockhash
is good for a minute or two, so it can never land after that), its amount
goes back on the ledger. Nothing more is sent to a wallet while a send is in
the air. So a wallet can be paid late, but never twice and never not at all.

The environment needs three things for automatic payment:

| Variable | What it is |
|---|---|
| `POG_AIRDROP_WALLET` | the airdrop wallet's public key |
| `POG_AIRDROP_KEYPAIR` | its secret key — either the JSON byte array from the Solana CLI (`[12,34,...]`) or the base58 string Phantom/Solflare export. The hot key: keep this wallet holding the allocation and nothing else, and mark the variable Sensitive in Vercel |
| `CRON_SECRET` | any secret; Vercel sends it with the daily cron so nobody else can call it |

**Arena stakes use the same wallet.** A real-token duel's stakes are paid into
the airdrop wallet and paid back out of it — to the winner both deposits, on
a draw or a cancelled match each side its own — and never more than the
verified deposits for that match. While a stake sits there it is counted in
`pog:escrow`, and the airdrop's daily budget is worked out from the balance
**less** that escrow and less every closed-day share not yet sent, so the
budget never hands out tokens that belong to a match or to a player who has
not collected. (A separate arena wallet can still be set with
`POG_ARENA_POOL` + `POG_ARENA_POOL_KEYPAIR`.)

Before `POG_MINT` is set the wallet runs as a ledger: days close, shares are
recorded and owed, nothing is sent. Once the token is live and the wallet is
funded, the budget is read from its on-chain balance and the owed amounts go
out on the next visit.

Nothing takes an amount or a recipient from a request: there is no endpoint
that closes a day (the dev one is localhost-only) and none that credits an
amount owed; `airdropcheck.mjs` asserts both, then banks Frost with two
wallets, closes the day and checks the shares.

### Why farming it is expensive

You cannot beat sybils with game design. Ten wallets playing an hour each will
always do what one wallet does in ten hours. What you *can* do is put a price
on every extra wallet and make depth beat breadth:

| Lever | What it costs an attacker |
|---|---|
| A wallet earns **zero** Frost until it qualifies: an hour of server-counted playtime, a captcha, and a minimum on-chain balance | an hour, a solve and real money — **per wallet** |
| The daily base is capped, and the cap is reachable in a normal session | no wallet can out-grind any other |
| Multipliers stack multiplicatively on that capped base | a deep wallet is worth ~2.9x a fresh one |
| Holder tiers are **absolute**, not proportional | splitting a bag across ten wallets drops all ten a tier |
| The streak has to be kept alive daily | ten wallets is ten lots of daily attention |
| Offerings cost materials gathered under the existing per-minute caps | the cairn cannot be pushed harder than the world allows |

And the structural one: **there is no endpoint that credits Frost.** It is only
ever written from inside `heartbeat`, `claimQuest`, `buildIgloo` and `offer` —
actions the server has already validated on its own terms. `cheatcheck` asserts
this by firing at `/api/season/{credit,grant,award,add,set}` and requiring 404.

### The chain side

`POG_MINT` is unset until the token launches, which is how the code detects
that there is no token yet: the holder gate and the holder multiplier are
simply not part of the checklist. Once it is set, `src/server/chain.ts` reads
the balance over one JSON-RPC call, cached for five minutes. It fails
**closed** — an unknown balance earns no bonus and satisfies no gate — because
failing open would hand every sybil the thing the gate exists to prevent. It
can never block play, only accrual.

The same is true of the captcha, which needs **both** halves of the Turnstile
pair — `TURNSTILE_SECRET` and `TURNSTILE_SITE_KEY`. With either missing the
requirement is *dropped from the checklist* rather than marked as passed. Those
are not the same thing, twice over: a "verified" mark nobody earned would still
be there after the secret was finally configured, and a secret set without a
site key would put an item on the checklist that no browser could satisfy,
locking every player out of Frost with a config change that looked complete.

The site key is served from `/api/season/config` rather than baked in at build
time, so there is exactly one place to configure it and no way to half-enable it.

### Turning the token on

`POG_MINT` is the switch. Setting it enables the holder multiplier **and** the
minimum-hold gate, and `GATE.hold` in `shared/season.js` decides how hard that
gate bites:

| `GATE.hold` | What happens |
|---|---|
| `25_000` (default) | Only holders earn Frost at all. Strongest sybil defence; narrowest audience. |
| `0` | Anyone can earn; holding still multiplies (+15/30/50%). The checklist drops the item entirely rather than showing "Hold 0". |
| — (`POG_MINT` unset) | The chain is not consulted at all. |

Worth re-reading each season: 25,000 is 0.0025% of supply, so its dollar cost
moves with the price — about $25 at a $1M FDV, $250 at $10M.

### Manual payouts, and one-off drops

The daily payout needs no operator. The tools below remain for a one-off
drop — a season prize, say — and for the case where the airdrop key is kept
off the server and owed amounts are sent by hand:

```bash
node --env-file=.vercel/.env.prod tools/audit.mjs          # what does not look human
node --env-file=.vercel/.env.prod tools/snapshot.mjs       # a payout list + merkle root from the season board
node tools/send.mjs                                        # DRY RUN — reports, sends nothing
node tools/send.mjs --send --limit 25                      # a small first batch
```

`send.mjs` moves real money, so it is built to be boring about it. Dry run is
the default. It reads the treasury key only from the path in `TREASURY_KEYPAIR`
— never a prompt, an argument or a config file. It preflights the token
balance, the SOL for fees and the rent for any accounts that need creating,
and refuses to start if any is short. Every confirmed signature is appended to
`<snapshot>.sent.json` before the next batch starts, and a re-run skips
everyone already in it — so a crash, a timeout or a Ctrl-C costs nothing and
nobody is paid twice.

`audit.mjs` flags rather than bans. The signal worth reading is the **cluster**
check: sybil rings are cheap to run but expensive to individualise, so their
wallets tend to be created minutes apart and land on near-identical scores.

## Anti-automation

The world is simulated in the browser, so the API cannot watch you play. What
it can do is refuse anything a real player could not have done.

| Rule | What it stops |
|---|---|
| Every action carries a position, checked against where you last acted and the time since | Teleporting between resource nodes |
| The position must be within reach of the node you name | Working a node from across the map |
| Minimum 800 ms between actions, plus per-minute caps per resource | Request bursts |
| What a wallet may hold scales with minutes actually played, credited at most one per real minute | Pumping a freshly created wallet |
| Node cooldowns live in a Redis sorted set, claimed with an atomic add | Two players banking the same tree |
| Balances, skins and igloos are only ever written by the API | Anything forged on the MQTT presence channel |
| Quest progress is incremented from inside the actions, never from a request | Reporting quests complete without playing |
| Quest rewards are gated on an atomic per-quest key | Claiming the same reward twice, or racing two claims |
| The respawn jump is only ever to *your own* igloo, once a minute | Using a built igloo as a teleport between resource nodes |
| Frost has no endpoint that writes it, and a profile write cannot set it | Injecting an airdrop balance |
| A wallet accrues nothing until it has paid the qualifying cost | Spinning up wallets to farm the drop |
| **Every write to a wallet runs under that wallet's lock** (`server/lock.ts`) | Firing two requests at once so the second write undoes the first: placing a furnishing while a stale write puts it back in the pack, removing one piece twice, buying an igloo while another request restores the $POG |
| A coin claim must carry a position | Sweeping every coin on the map from nowhere |
| The jump to the plaza (a rejoin) is allowed once a minute, like the jump home | Using "I am at the plaza" as a free teleport to the cairn |
| Igloo yield is settled per whole day paid, and the clock restarts on a level change | Furnishing an empty Shelter and being paid three days of Palace for the time it stood empty |
| Names are claimed with an atomic `hsetnx` | Two wallets racing for one name both winning it |

Scripts keep this honest:

```bash
node tools/cheatcheck.mjs    # 40 attacks, every line must read PASS
node tools/loopcheck.mjs     # the honest loop: chop, craft, fish, build
node tools/questcheck.mjs    # rod -> fish -> cookout -> quests -> streak
node tools/seasonmath.mjs    # caps, tiers, shares and the merkle tree (no server)
node tools/salecheck.mjs     # the on-chain sale verifier against fixtures, and the yield clock (no server)
node tools/arenacheck.mjs    # two wallets fight a full duel, and try every way to cheat it
node tools/cavecheck.mjs     # a run in the caves: walks out, gets eaten, and cheats at both
node tools/marketcheck.mjs   # the goods market and the casino, honestly and otherwise
node tools/airdropcheck.mjs  # the daily airdrop: the maths, a day closed, the shares owed
node tools/seasoncheck.mjs   # the season against a real API
node tools/send.mjs          # dry run: what a payout would do, sending nothing

# seasoncheck needs the hour-long playtime gate lowered, which no test can sit through:
POG_GATE_MINUTES=1 POG_GATE_MINUTES_TODAY=1 npm run dev
```

None of this makes cheating impossible — a determined attacker can simulate a
player walking around. It makes cheating no faster than playing, which is the
ceiling without an authoritative server. If the game ever needs a hard
guarantee, the move is a stateful server process (the architecture this repo
started from) or gating rewards on an on-chain balance.

## Architecture

The whole point of this shape is that **nothing has to stay running**.

```
        ┌──────────── browser ────────────┐
        │  Canvas renderer + simulation   │
        └───┬──────────────────────┬──────┘
            │                      │
   positions│chat                  │ auth, profiles, $POG
            ▼                      ▼
  ┌────────────────────┐   ┌────────────────────────┐
  │ public MQTT broker │   │ Vercel functions /api  │
  │  (HiveMQ, free)    │   │          ↓             │
  │  ~7 msgs/sec/player│   │    Upstash Redis       │
  └────────────────────┘   └────────────────────────┘
     ephemeral, untrusted      durable, authoritative
```

**Presence over MQTT.** Each client publishes its penguin's position to
`pogfrozenworld/v1/world/<wallet>` about seven times a second and subscribes to everyone
else's. A player is "present" only while their messages keep arriving — each carries a
timestamp and is dropped after 4 s — so a closed tab fades out on its own. This channel is
peer-to-peer in spirit: no server of ours sits in the middle, which is exactly why it works
on a static host.

**Anything worth cheating for goes through the API.** Usernames, $POG balances and coin
ownership are never trusted from MQTT. Picking up a coin hides it locally and immediately
calls `POST /api/world/claim`; the function checks the session, rate-limits the wallet, and
uses a Redis sorted set to make sure exactly one player can claim a given coin before it
respawns.

**Trade-offs, stated plainly.** Presence messages are unauthenticated, so a determined
player could publish a fake penguin or someone else's name tag. That affects cosmetics only
— it cannot mint $POG or steal a username. With no authoritative server there is also no
server-side collision or anti-teleport check on movement. Both are fixable later by moving
presence onto a dedicated broker with per-client credentials.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

`server.ts` runs Vite and loads the same `api/**` handlers the deploy uses, so `/api/*`
behaves identically in dev. Without Upstash credentials the API keeps everything in memory —
fine for local work, wiped on restart. Multiplayer needs no local setup at all; the public
broker is shared, so two browser windows will already see each other.

## Layout

```
api/
  auth/[action].ts      nonce, verify, logout     (Solana ed25519 signature)
  profile/[action].ts   me, set, namecheck, leaderboard
  world/[action].ts     coins, claim, stats
  game/[action].ts      state, gather, craft, build, buy, equip, quests, quest
  season/[action].ts    config, status, board, offer, verify
  online/[action].ts    beat, count
shared/world.js         deterministic world gen — imported by the client AND the API
shared/season.js        season rules: the gate, the caps, the tiers, the share maths
src/
  game/engine.ts        loop, camera, input, rendering
  game/presence.ts      MQTT multiplayer
  game/penguin.ts       the $POG penguin, drawn to a sprite sheet
  game/scenery.ts       ground chunks, trees, lanterns, coins
  server/kv.ts          Upstash Redis + in-memory fallback
  server/game.ts        auth, profiles, the $POG economy
  server/season.ts      the Frost ledger — one write path, no request reaches it
  server/chain.ts       on-chain $POG balance, cached, fails closed
  server/human.ts       Turnstile, one pass per wallet per season
  components/TurnstileGate.tsx   the captcha widget, rendered only when fully configured
  pages/                Landing.tsx, Play.tsx
server.ts               local dev bridge (Vite + the api/ handlers)
```

## How login works

1. Client asks `GET /api/auth/nonce?wallet=…`.
2. The wallet signs a plain-text message containing that nonce (`solana:signMessage`).
3. `POST /api/auth/verify` checks the ed25519 signature against the wallet's public key
   (`tweetnacl`), burns the nonce, and issues a bearer token good for 7 days.
4. The token authorises profile writes and coin claims.

No transaction is ever requested and the server never sees a private key.

## Deploying to Vercel

Live: **https://pog-client-five.vercel.app**

1. Import the repo. Root Directory must be the repo root (`.`) — `api/` has to sit at the
   top level for Vercel to pick the functions up. The rest of `vercel.json` is correct as
   committed: build `vite build`, output `dist`.
2. Add **Upstash for Redis** from the Vercel Marketplace and connect it to the project.
   That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically, which is exactly what
   `src/server/kv.ts` reads. Give the game its own store rather than sharing one with
   another project — the free tier's request budget is per database.
3. Optionally set `VITE_POG_CONTRACT` to the mint address once the token is live.

**Without Redis the deploy still loads, but nothing persists** — each function invocation
gets a fresh in-memory store, so usernames and $POG vanish between requests. Check
`/api/world/stats`: it reports `"persistent": true` once Redis is wired up.

Note that relative imports in `api/**` and `src/server/**` need explicit `.js`
extensions. The package is ESM, and Node resolves the compiled functions the same way —
an extensionless specifier throws on load and every route answers
`FUNCTION_INVOCATION_FAILED`.

| Variable | Where | Purpose |
|---|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | server | Upstash Redis (set by the integration) |
| `POG_KV_REST_API_URL` / `POG_KV_REST_API_TOKEN` | server | override the above if you prefer explicit names |
| `VITE_POG_CONTRACT` | build | contract address shown on the landing page |
| `POG_MINT` | server | the SPL mint. **Unset until launch** — while it is, the holder gate and holder multiplier are left out of the checklist entirely |
| `SOLANA_RPC_URL` | server | defaults to the public mainnet RPC, which is rate-limited. Point it at Helius or QuickNode before launch |
| `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY` | server | Cloudflare Turnstile. **Both or neither** — either one missing drops the captcha from the checklist. The site key is public and is served to the browser from `/api/season/config` |
| `TREASURY_KEYPAIR` | local only | Path to the Solana CLI keypair that pays the airdrop. Read by `tools/send.mjs` and nothing else. **Never set this on Vercel** |
| `POG_GATE_MINUTES` / `POG_GATE_MINUTES_TODAY` | server | **test seam only.** Lowers the playtime gate so `seasoncheck` can run. Never set in production |
| `VITE_MQTT_URL` | build | swap the public broker for a dedicated one |

### What lives where

| Data | Store | Key |
|---|---|---|
| Username, scarf colour, $POG balance | Redis | `pog:wallet:<address>` |
| Name uniqueness index | Redis hash | `pog:names` |
| Login sessions (7 days) | Redis | `pog:sess:<token>` |
| Coins currently picked up | Redis sorted set | `pog:coins` |
| Nodes on cooldown | Redis sorted set | `pog:nodes` |
| Player-built igloos | Redis hash | `pog:igloos` |
| Today's quest progress | Redis (3-day TTL) | `pog:quests:<address>:<yyyy-mm-dd>` |
| Frost per wallet, this season | Redis sorted set | `pog:frost:s<n>` |
| Total Frost, for the share estimate | Redis counter | `pog:frostpool:s<n>` |
| Captcha passed this season | Redis | `pog:human:s<n>:<address>` |
| Cached on-chain balance | Redis (5-min TTL) | `pog:hold:<address>` |
| Quest rewards already paid | Redis (3-day TTL) | `pog:qc:<address>:<day>:<quest>` |
| Leaderboard | Redis sorted set | `pog:lb` |
| Penguin positions, chat | nowhere — in flight only | MQTT topics |

### About the public broker

`broker.hivemq.com` is free and needs no account, which makes launch day easy, but it is a
shared best-effort service with no delivery guarantee. If presence starts feeling flaky,
point `VITE_MQTT_URL` at a HiveMQ Cloud or EMQX Cloud free tier instance — it is a one-line
change.

## Roadmap

- **Phase 1 — Ice break** ✅ wallet login, spawn plaza, multiplayer, usernames
- **Phase 2 — Waddle** ✅ wood, ice and fishing, the workbench and stall, player-built igloos, hats
- **Phase 3 — Deep winter** ✅ daily quests and streaks, the plaza cookout, respawning at your igloo, phone controls
- **Phase 4 — The season** ✅ Frost, the qualifying gate, holder tiers, the cairn, snapshot and audit tooling
- **Phase 5 — Blizzard** — ✅ igloo furniture, interiors and levels, skills, the igloo market (soft and on-chain) · still to come: a snowball PvP arena, guilds
- **Phase 6 — Glacier** — the claim contract, NFT skins, tournaments

A note on the PvP arena: presence is peer-to-peer and unauthenticated, so
real-time combat with anything at stake cannot be made honest in this
architecture. Either it stays purely for fun, or it gets its own stateful
server process — there is no middle ground worth shipping.

---

$POG is a memecoin created for entertainment. In-game $POG points are not a security and
are not redeemable on-chain today. Nothing here is financial advice.
