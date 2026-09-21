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
| **The world** | 6400 × 6400 units of pine forest, frozen lakes and igloo camps, generated deterministically from one seed. |
| **Multiplayer** | Everyone shares one map over a public MQTT broker — positions, chat and name tags in real time. |
| **Play to earn** | 260 $POG coins on the ice; claims are validated server-side and banked per wallet on a live leaderboard. |

Every visual is drawn procedurally with Canvas 2D — the penguin, the trees, the ice, the
coins. No sprite sheets to ship and no third-party art licences to track.

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
  online/[action].ts    beat, count
shared/world.js         deterministic world gen — imported by the client AND the API
src/
  game/engine.ts        loop, camera, input, rendering
  game/presence.ts      MQTT multiplayer
  game/penguin.ts       the $POG penguin, drawn to a sprite sheet
  game/scenery.ts       ground chunks, trees, igloos, coins
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

1. Import the repo. The defaults in `vercel.json` are correct — build `vite build`,
   output `dist`, functions from `api/`.
2. Add **Upstash Redis** from the Vercel Marketplace and connect it to the project. That
   sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. Optionally set `VITE_POG_CONTRACT` to the mint address once the token is live.

**Without Redis the deploy still loads, but nothing persists** — each function invocation
gets a fresh in-memory store, so usernames and $POG vanish between requests. The landing
page reports this as `persistent: false` on `/api/world/stats`.

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
| Leaderboard | Redis sorted set | `pog:lb` |
| Penguin positions, chat | nowhere — in flight only | MQTT topics |

### About the public broker

`broker.hivemq.com` is free and needs no account, which makes launch day easy, but it is a
shared best-effort service with no delivery guarantee. If presence starts feeling flaky,
point `VITE_MQTT_URL` at a HiveMQ Cloud or EMQX Cloud free tier instance — it is a one-line
change.

## Roadmap

- **Phase 1 — Ice break** ✅ wallet login, spawn plaza, multiplayer, usernames
- **Phase 2 — Waddle** — emotes, proximity chat, cosmetics
- **Phase 3 — Blizzard** — snowball PvP, ice fishing, igloo housing
- **Phase 4 — Glacier** — on-chain reward claims, NFT skins, tournaments

---

$POG is a memecoin created for entertainment. In-game $POG points are not a security and
are not redeemable on-chain today. Nothing here is financial advice.
