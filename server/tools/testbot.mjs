// Local dev harness — never point this at production.
//
// Generates throwaway ed25519 keypairs (the same curve Solana wallets use),
// walks the real nonce -> signMessage -> token flow, and drives bot penguins
// around the spawn plaza so you can see multiplayer without a second browser.
//
//   node server/tools/testbot.mjs bots          # 3 wandering bots
//   node server/tools/testbot.mjs player Name   # print one session token

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import WebSocket from 'ws';

const BASE = 'http://localhost:8787';

export async function authenticate(name, color) {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);

  const nonceRes = await fetch(`${BASE}/api/nonce?wallet=${wallet}`).then((r) => r.json());
  if (!nonceRes.message) throw new Error('nonce failed: ' + JSON.stringify(nonceRes));

  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(nonceRes.message), kp.secretKey)
  );

  const auth = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, signature }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error('auth failed: ' + JSON.stringify(auth));

  const prof = await fetch(`${BASE}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ name, color }),
  }).then((r) => r.json());
  if (!prof.profile) throw new Error('profile failed: ' + JSON.stringify(prof));

  return { wallet, token: auth.token, profile: prof.profile };
}

function runBot({ token, name }, angleOffset) {
  const ws = new WebSocket('ws://localhost:8787/ws');
  let x = 3200;
  let y = 3200;
  let t = angleOffset;

  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', token })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') {
      x = m.you.x;
      y = m.you.y;
      console.log(`[${name}] joined as #${m.id}, ${m.players.length} others already here`);
      setTimeout(() => ws.send(JSON.stringify({ t: 'chat', text: `gm from ${name} 🐧` })), 1200);
    }
    if (m.t === 'error') console.log(`[${name}] server error:`, m.message);
  });

  setInterval(() => {
    t += 0.09;
    x = 3200 + Math.cos(t + angleOffset) * 150;
    y = 3200 + Math.sin(t * 1.3 + angleOffset) * 110;
    const dir = Math.abs(Math.cos(t)) > 0.5 ? (Math.cos(t) > 0 ? 'right' : 'left') : Math.sin(t) > 0 ? 'down' : 'up';
    ws.send(JSON.stringify({ t: 'move', x, y, dir, moving: true }));
  }, 90);

  return ws;
}

const mode = process.argv[2];

if (mode === 'player') {
  // one authenticated identity, printed for the browser to adopt
  const me = await authenticate(process.argv[3] || 'TestPenguin', '#38bdf8');
  console.log(JSON.stringify(me));
} else if (mode === 'bots') {
  const names = ['Frosty', 'Waddles', 'GlacierGuy'].map((n) => n + Math.floor(Math.random() * 90 + 10));
  const colors = ['#ff6b2c', '#a78bfa', '#34d399'];
  for (let i = 0; i < names.length; i++) {
    const acct = await authenticate(names[i], colors[i]);
    runBot({ ...acct, name: names[i] }, i * 2.1);
  }
  console.log('bots running');
}
