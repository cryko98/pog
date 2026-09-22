/**
 * The on-chain sale verifier, against fixtures. No chain, no server.
 *
 *   node tools/salecheck.mjs
 *
 * The token does not exist yet, so this is the only way the settlement
 * logic gets exercised before launch: hand it transactions shaped exactly
 * like `getTransaction(..., { encoding: 'jsonParsed' })` returns them, and
 * make sure it takes the one honest payment and refuses every variation a
 * buyer could try. Also covers the yield clock, which used to pay the new
 * level for the old level's time.
 */

import {
  MEMO_PROGRAM,
  TOKEN_PROGRAM,
  saleMemo,
  saleSplit,
  toBaseUnits,
  verifySaleTx,
} from '../shared/sale.js';
import { settleYieldAt, iglooLevel } from '../shared/world.js';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const BUYER = 'Buyer111111111111111111111111111111111111111';
const SELLER = 'Se11er11111111111111111111111111111111111111';
const OTHER = 'Other111111111111111111111111111111111111111';
const MINT = 'Mint1111111111111111111111111111111111111111';
const DECIMALS = 6;
const LISTED_AT = Date.parse('2026-10-01T12:00:00Z');
const PRICE = 1000;

const split = saleSplit(PRICE);
const terms = {
  buyer: BUYER,
  seller: SELLER,
  mint: MINT,
  memo: saleMemo(SELLER, LISTED_AT),
  takeHomeRaw: toBaseUnits(split.takeHome, DECIMALS),
  burnRaw: toBaseUnits(split.burn, DECIMALS),
  listedAt: LISTED_AT,
};

const units = (whole) => toBaseUnits(whole, DECIMALS).toString();

/** An honest payment, as the RPC would hand it back. */
function honest(overrides = {}) {
  const tx = {
    blockTime: Math.floor(LISTED_AT / 1000) + 120,
    meta: {
      err: null,
      preTokenBalances: [
        { accountIndex: 1, mint: MINT, owner: BUYER, uiTokenAmount: { amount: units(5000) } },
        { accountIndex: 2, mint: MINT, owner: SELLER, uiTokenAmount: { amount: units(10) } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: MINT, owner: BUYER, uiTokenAmount: { amount: units(5000 - PRICE) } },
        { accountIndex: 2, mint: MINT, owner: SELLER, uiTokenAmount: { amount: units(10 + split.takeHome) } },
      ],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: BUYER, signer: true, writable: true },
          { pubkey: 'BuyerAta', signer: false, writable: true },
          { pubkey: 'SellerAta', signer: false, writable: true },
        ],
        instructions: [
          {
            program: 'spl-token',
            programId: TOKEN_PROGRAM,
            parsed: {
              type: 'transferChecked',
              info: { mint: MINT, authority: BUYER, source: 'BuyerAta', destination: 'SellerAta', tokenAmount: { amount: units(split.takeHome) } },
            },
          },
          {
            program: 'spl-token',
            programId: TOKEN_PROGRAM,
            parsed: {
              type: 'burnChecked',
              info: { mint: MINT, authority: BUYER, account: 'BuyerAta', tokenAmount: { amount: units(split.burn) } },
            },
          },
          { program: 'spl-memo', programId: MEMO_PROGRAM, parsed: saleMemo(SELLER, LISTED_AT) },
        ],
      },
    },
  };
  return typeof overrides === 'function' ? overrides(tx) : { ...tx, ...overrides };
}

console.log('--- the split ---');
check('8% of 1000 burns 80, seller keeps 920', split.burn === 80 && split.takeHome === 920, JSON.stringify(split));
check('a 1-token sale still burns at least 1', saleSplit(1).burn === 1 && saleSplit(1).takeHome === 0);
check('base units carry decimals exactly', units(920) === '920000000');
check('a billion tokens with 9 decimals does not overflow', toBaseUnits(1_000_000_000, 9) === 10n ** 18n);

console.log('\n--- the honest payment ---');
check('an honest payment is accepted', verifySaleTx(honest(), terms).ok === true, JSON.stringify(verifySaleTx(honest(), terms)));
check(
  'a burn reported as an inner instruction still counts',
  verifySaleTx(
    honest((tx) => {
      const [transfer, burn, memo] = tx.transaction.message.instructions;
      tx.transaction.message.instructions = [transfer, memo];
      tx.meta.innerInstructions = [{ index: 0, instructions: [burn] }];
      return tx;
    }),
    terms
  ).ok === true
);
check(
  'a plain `transfer` and `burn` (unchecked) are accepted too',
  verifySaleTx(
    honest((tx) => {
      tx.transaction.message.instructions[1].parsed = {
        type: 'burn',
        info: { mint: MINT, authority: BUYER, account: 'BuyerAta', amount: units(split.burn) },
      };
      return tx;
    }),
    terms
  ).ok === true
);
check(
  'overpaying is fine',
  verifySaleTx(
    honest((tx) => {
      tx.meta.postTokenBalances[1].uiTokenAmount.amount = units(10 + split.takeHome + 5);
      return tx;
    }),
    terms
  ).ok === true
);

console.log('\n--- every way to cheat it ---');
const refuse = (label, tx, want) => {
  const v = verifySaleTx(tx, terms);
  check(label, v.ok === false && (!want || v.reason.includes(want)), v.reason || 'accepted!');
};

refuse('a failed transaction', honest({ meta: { ...honest().meta, err: { InstructionError: [0, 'Custom'] } } }), 'failed');
refuse('no transaction at all', null);
refuse('a transaction somebody else signed', honest((tx) => {
  tx.transaction.message.accountKeys[0].pubkey = OTHER;
  return tx;
}), 'did not sign');
refuse('the buyer present but not as a signer', honest((tx) => {
  tx.transaction.message.accountKeys[0].signer = false;
  return tx;
}), 'did not sign');
refuse("a payment for somebody else's listing (wrong memo)", honest((tx) => {
  tx.transaction.message.instructions[2].parsed = saleMemo(OTHER, LISTED_AT);
  return tx;
}), 'not for this listing');
refuse('a payment for an older listing by the same seller', honest((tx) => {
  tx.transaction.message.instructions[2].parsed = saleMemo(SELLER, LISTED_AT - 1);
  return tx;
}), 'not for this listing');
refuse('no memo', honest((tx) => {
  tx.transaction.message.instructions.pop();
  return tx;
}), 'not for this listing');
refuse('the seller paid less than the take-home', honest((tx) => {
  tx.meta.postTokenBalances[1].uiTokenAmount.amount = units(10 + split.takeHome - 1);
  return tx;
}), 'not paid');
refuse('the take-home sent to a different wallet', honest((tx) => {
  tx.meta.preTokenBalances[1].owner = OTHER;
  tx.meta.postTokenBalances[1].owner = OTHER;
  return tx;
}), 'not paid');
refuse('the right amount of the WRONG token', honest((tx) => {
  for (const b of [...tx.meta.preTokenBalances, ...tx.meta.postTokenBalances]) b.mint = 'Wrong' + MINT.slice(5);
  return tx;
}), 'not paid');
refuse('the house cut sent to a friend instead of burned', honest((tx) => {
  tx.transaction.message.instructions[1].parsed = {
    type: 'transferChecked',
    info: { mint: MINT, authority: BUYER, source: 'BuyerAta', destination: 'FriendAta', tokenAmount: { amount: units(split.burn) } },
  };
  return tx;
}), 'not burned');
refuse('the house cut burned short', honest((tx) => {
  tx.transaction.message.instructions[1].parsed.info.tokenAmount.amount = units(split.burn - 1);
  return tx;
}), 'not burned');
refuse('a burn of a different mint', honest((tx) => {
  tx.transaction.message.instructions[1].parsed.info.mint = 'Wrong' + MINT.slice(5);
  return tx;
}), 'not burned');
refuse('a burn somebody else authorised', honest((tx) => {
  tx.transaction.message.instructions[1].parsed.info.authority = OTHER;
  return tx;
}), 'not burned');
refuse('a payment made before the listing existed', honest({ blockTime: Math.floor(LISTED_AT / 1000) - 3600 }), 'predates');
refuse('balances with no owner field cannot pass as the seller', honest((tx) => {
  delete tx.meta.postTokenBalances[1].owner;
  return tx;
}), 'not paid');

console.log('\n--- the yield clock ---');
const DAY = 86_400_000;
const palace = Array.from({ length: 7 }, (_, i) => ({ id: 'throne', x: i * 10, y: 0 }));
check('seven thrones make a Palace', iglooLevel(palace).daily === 7, `daily=${iglooLevel(palace).daily}`);
{
  const t0 = 1_000_000_000_000;
  const r = settleYieldAt([], t0, t0 + 3 * DAY, true);
  check('an empty Shelter pays nothing for three days', r.paid === 0);
  check('...and on a level change the clock jumps to now', r.next === t0 + 3 * DAY);
  const after = settleYieldAt(palace, r.next, r.next + 60_000);
  check('so a Palace furnished a minute ago has earned nothing yet', after.paid === 0, `paid=${after.paid}`);
}
{
  const t0 = 1_000_000_000_000;
  const r = settleYieldAt(palace, t0, t0 + 1.5 * DAY);
  check('a Palace after a day and a half pays 10', r.paid === 10, `paid=${r.paid}`);
  check('...and the clock moves by the 10/7 days that paid, not to now', r.next === t0 + Math.floor((10 / 7) * DAY), `${r.next - t0}`);
  const again = settleYieldAt(palace, r.next, t0 + 3 * DAY);
  check('the remainder is paid later, not forfeited', r.paid + again.paid === 21, `total=${r.paid + again.paid}`);
}
{
  const t0 = 1_000_000_000_000;
  const r = settleYieldAt(palace, t0, t0 + 10 * DAY);
  check('past the cap, three days are paid', r.paid === 21, `paid=${r.paid}`);
  check('...and the excess is forfeited (clock to now)', r.next === t0 + 10 * DAY);
}
{
  const den = [{ id: 'rug', x: 0, y: 0 }, { id: 'rug', x: 30, y: 0 }, { id: 'rug', x: 60, y: 0 }, { id: 'rug', x: 90, y: 0 }, { id: 'rug', x: 120, y: 0 }, { id: 'rug', x: 150, y: 0 }];
  const t0 = 1_000_000_000_000;
  let since = t0;
  let total = 0;
  for (let i = 1; i <= 48; i++) {
    const r = settleYieldAt(den, since, t0 + i * (DAY / 4));
    total += r.paid;
    since = r.next;
  }
  check('checking in four times a day for 12 days loses nothing', total === 12, `total=${total}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
