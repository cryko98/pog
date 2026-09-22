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
| **Survival loop** | Chop wood, cut ice, fish. Craft a rod, then an igloo kit, then raise the igloo — all validated server-side. |
| **Daily quests** | Three a day, derived from your wallet address and the UTC date. Clear all three and a streak bonus stacks on top. |
| **Play to earn** | 70 scarce $POG coins on the ice, the plaza cookout, and quest rewards — spendable only on hats. Balances are banked per wallet on a live leaderboard. |
| **Phone support** | An on-screen action button next to the virtual stick, so gathering, the stations and building all work without a keyboard. |

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
5 fish   -> 1 $POG   |   30 fish -> 7 $POG     (the plaza fire)
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

**$POG is cosmetic only.** Coins are scarce — 70 on the whole map with a
four-minute respawn — and the only thing they buy is a hat in the shop.
Nothing purchasable makes you gather faster; the real economy is wood, ice
and fish. The cookout and the quest board add two more ways in, both bounded
by the same gathering caps: the 21 fishing holes can only produce so much fish
per minute no matter how many players work them.

Guests can walk, slide and chat, but nothing they do is recorded: $POG is
credited to a wallet address, and a guest has none.

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

Three scripts keep this honest:

```bash
node tools/cheatcheck.mjs   # 32 attacks, every line must read PASS
node tools/loopcheck.mjs    # the honest loop: chop, craft, fish, build
node tools/questcheck.mjs   # rod -> fish -> cookout -> quests -> streak
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
  online/[action].ts    beat, count
shared/world.js         deterministic world gen — imported by the client AND the API
src/
  game/engine.ts        loop, camera, input, rendering
  game/presence.ts      MQTT multiplayer
  game/penguin.ts       the $POG penguin, drawn to a sprite sheet
  game/scenery.ts       ground chunks, trees, lanterns, coins
  server/kv.ts          Upstash Redis + in-memory fallback
  server/game.ts        auth, profiles, the $POG economy
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
- **Phase 4 — Blizzard** — igloo furniture and interiors, an igloo marketplace, a snowball PvP arena, guilds
- **Phase 5 — Glacier** — on-chain reward claims, NFT skins, tournaments

A note on the PvP arena: presence is peer-to-peer and unauthenticated, so
real-time combat with anything at stake cannot be made honest in this
architecture. Either it stays purely for fun, or it gets its own stateful
server process — there is no middle ground worth shipping.

---

$POG is a memecoin created for entertainment. In-game $POG points are not a security and
are not redeemable on-chain today. Nothing here is financial advice.
