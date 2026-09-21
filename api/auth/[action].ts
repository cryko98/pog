/**
 * Wallet login. Nothing is ever signed on chain — the wallet signs a
 * plain-text message containing a nonce we issued, and we check the ed25519
 * signature against its public key.
 *
 *   GET  nonce?wallet=<address>   -> { message }
 *   POST verify { wallet, signature } -> { token, profile }
 *   POST logout  (Bearer token)   -> { ok }
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { actionOf, bearer, body, json, query } from '../_shared.js';
import { dropSession, getProfile, isValidWallet, issueNonce, loginMessage, verifyLogin } from '../../src/server/game.js';

export default async function handler(req: any, res: any) {
  const action = actionOf(req, 'auth');

  try {
    if (action === 'nonce') {
      const wallet = query(req, 'wallet') || body(req).wallet;
      if (!isValidWallet(wallet)) return json(res, 400, { error: 'Invalid wallet address.' });
      const nonce = await issueNonce(wallet);
      return json(res, 200, { message: loginMessage(nonce) });
    }

    if (action === 'verify') {
      const { wallet, signature } = body(req);
      if (!isValidWallet(wallet)) return json(res, 400, { error: 'Invalid wallet address.' });
      if (typeof signature !== 'string') return json(res, 400, { error: 'Missing signature.' });

      const token = await verifyLogin(wallet, signature);
      if (!token) {
        return json(res, 401, { error: 'Signature did not check out — try connecting again.' });
      }
      return json(res, 200, { token, wallet, profile: await getProfile(wallet) });
    }

    if (action === 'logout') {
      await dropSession(bearer(req) || body(req).token);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Unknown auth action.' });
  } catch (err: any) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}
