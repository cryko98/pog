/**
 * A small sorted-pair merkle tree, for publishing a claim root.
 *
 *   leaf   = sha256("<wallet>:<tokens>")
 *   parent = sha256(min(a,b) || max(a,b))
 *
 * Sorting the pair means a proof carries no direction bits, which keeps the
 * on-chain verifier trivial. An odd node at the end of a layer is PROMOTED
 * rather than hashed with itself: duplicating a node lets one leaf's proof
 * verify for a sibling that does not exist, which is a real forgery route.
 *
 * Whatever distributor program ends up being used will define its own leaf
 * encoding — match `leafFor` to it before publishing a root.
 */

import { createHash } from 'node:crypto';

const sha = (buf) => createHash('sha256').update(buf).digest();

export const leafFor = (wallet, tokens) => sha(`${wallet}:${tokens}`);

const parent = (a, b) =>
  Buffer.compare(a, b) <= 0 ? sha(Buffer.concat([a, b])) : sha(Buffer.concat([b, a]));

/** Build every layer, bottom first. `layers[last]` holds the root. */
export function buildTree(leaves) {
  if (!leaves.length) return { root: null, layers: [[]] };
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? parent(prev[i], prev[i + 1]) : prev[i]);
    }
    layers.push(next);
  }
  return { root: layers[layers.length - 1][0], layers };
}

/** The sibling hashes needed to walk `index` up to the root. */
export function proofFor(layers, index) {
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const sibling = idx ^ 1;
    // no sibling means this node was promoted; nothing to add at this level
    if (sibling < layers[l].length) proof.push(layers[l][sibling]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute the root from a leaf and its proof. */
export function verifyProof(leaf, proof, root) {
  if (!root) return false;
  let node = leaf;
  for (const sibling of proof) {
    node = parent(node, Buffer.isBuffer(sibling) ? sibling : Buffer.from(sibling, 'hex'));
  }
  return Buffer.compare(node, root) === 0;
}
