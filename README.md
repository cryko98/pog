# $POG — Frozen Open World

A winter open-world multiplayer play-to-earn browser game for the **$POG** Solana memecoin.
Connect a Solana wallet, name your penguin, and spawn onto a shared snowfield with everyone
else who is online.

![stack](https://img.shields.io/badge/stack-React%20·%20Vite%20·%20Canvas%202D%20·%20Node%20WS-38bdf8)

## What's in here

| | |
|---|---|
| **Landing page** | Hero, feature grid, how-to-play, tokenomics, roadmap, and a big **PLAY** button. |
| **Wallet login** | Wallet Standard (Phantom, Solflare, Backpack, Glow…). One free off-chain signature — never a transaction. |
| **Username** | Bound to the wallet address server-side, unique across players, editable any time. Scarf colour too. |
| **The world** | 6400 × 6400 unit snowfield: pine forest, frozen lakes, igloo camps, ice spikes, snowmen. Deterministic from one seed — no art assets to ship. |
| **Multiplayer** | WebSocket server at 12 Hz. Everyone spawns in the same plaza under the $POG banner and sees each other move, waddle and chat live. |
| **Play to earn** | 260 $POG coins scattered across the map, banked per wallet, shown on a live leaderboard. |

Everything is drawn procedurally with Canvas 2D — the penguin, the trees, the ice, the coins.
No sprite sheets to download and no third-party art licences to track.

## Quick start

```bash
npm install
npm run dev
```

- client → http://localhost:5173 (Vite, proxies `/api` and `/ws` to the server)
- server → http://localhost:8787

Production:

```bash
npm run build   # builds client/dist
npm start       # server serves the API, the WebSocket and client/dist on :8787
```

## Layout

```
shared/world.js      deterministic world generation — imported by BOTH sides
                     (seed, lakes, props, collision, coin placement)
client/
  src/game/          engine.ts (loop, camera, input, netcode)
                     penguin.ts (the $POG penguin, drawn to a sprite sheet)
                     scenery.ts (ground chunks, trees, igloos, coins)
                     net.ts     (WebSocket client with reconnect)
  src/pages/         Landing.tsx, Play.tsx
  src/state/         session.tsx — wallet + profile context
  src/lib/           wallet.ts (Wallet Standard), api.ts
server/
  src/index.js       HTTP API + WebSocket world loop
  src/store.js       flat-file persistence (profiles, sessions)
  tools/testbot.mjs  local dev bots
```

## How login works

1. Client asks `GET /api/nonce?wallet=…`.
2. Wallet signs a plain-text message containing that nonce (`solana:signMessage`).
3. Server verifies the ed25519 signature against the wallet's public key
   (`tweetnacl`) and issues a bearer token, good for 7 days.
4. The token authorises `POST /api/profile` and the `join` message on the socket.

No transaction is ever requested, and the server never sees a private key.

## Anti-cheat

The client simulates its own penguin for responsiveness, but the server
re-validates: movement is speed-clamped and pushed out of solid props, and coin
pickups are only credited when the server agrees the player was close enough and
the coin was not already taken.

## Configuration

| Variable | Where | Default |
|---|---|---|
| `PORT` | server | `8787` |
| `POG_SERVER` | client dev proxy target | `http://localhost:8787` |
| `VITE_POG_CONTRACT` | client build | `TBA — dropping at launch` |

Set the contract address at build time once the token is live:

```bash
VITE_POG_CONTRACT=YourMintAddressHere npm run build
```

## Testing multiplayer locally

```bash
npm start                          # terminal 1
node server/tools/testbot.mjs bots # terminal 2 — 3 bot penguins join and chat
```

## Notes on persistence

Profiles and sessions are JSON files under `server/data/` (gitignored), flushed
every few seconds. That is fine for launch traffic on a single box; swap the
four functions in `server/src/store.js` for Postgres or Redis before scaling to
multiple server processes.

## Roadmap (in the game, not just the README)

- **Phase 1 — Ice break** ✅ wallet login, spawn plaza, multiplayer, usernames
- **Phase 2 — Waddle** — emotes, proximity chat, cosmetics
- **Phase 3 — Blizzard** — snowball PvP, ice fishing, igloo housing
- **Phase 4 — Glacier** — on-chain reward claims, NFT skins, tournaments

---

$POG is a memecoin created for entertainment. In-game $POG points are not a
security and are not redeemable on-chain today. Nothing here is financial advice.
