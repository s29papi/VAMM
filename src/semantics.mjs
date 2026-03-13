import { randomBytes } from "node:crypto";

import { encodeBytes32String, keccak256, toBeHex, toBigInt as ethersToBigInt } from "ethers";
import { Plaintext, Poseidon2, Poseidon4 } from "@provablehq/sdk";

import {
  EMPTY_ROOT,
  IDENTITY_DOMAIN,
  MAX_GROUP_SIZE,
  MEMBER_COMMITMENT_DOMAIN,
  MEMBER_SLOT_DOMAIN,
  MERKLE_DEPTH,
  NULLIFIER_DOMAIN,
  ROOT_HISTORY_DOMAIN
} from "./constants.mjs";

const poseidon2Hasher = new Poseidon2();
const poseidon4Hasher = new Poseidon4();

function parseAleoFieldString(value) {
  if (typeof value !== "string" || !value.endsWith("field")) {
    throw new TypeError(`invalid Aleo field string: ${value}`);
  }

  return BigInt(value.slice(0, -5));
}

function hashTypedFieldArray(hasher, values) {
  const plaintext = Plaintext.fromString(
    `[${values.map((value) => `${normalizeField(value)}field`).join(", ")}]`
  );
  const encodedFields = plaintext.toFields();
  const result = hasher.hash(encodedFields);
  return parseAleoFieldString(result.toString());
}

function normalizeNonNegativeInteger(value) {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new RangeError("numeric values must be non-negative");
    }

    return value;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError("numeric values must be non-negative integers");
    }

    return BigInt(value);
  }

  if (typeof value === "string") {
    const parsed = ethersToBigInt(value);
    if (parsed < 0n) {
      throw new RangeError("numeric values must be non-negative");
    }

    return parsed;
  }

  throw new TypeError(`unsupported numeric value type: ${typeof value}`);
}

function isNumericString(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    normalizeNonNegativeInteger(value);
    return true;
  } catch {
    return false;
  }
}

function asLength(value) {
  const normalized = normalizeField(value);
  if (normalized > BigInt(MERKLE_DEPTH)) {
    throw new RangeError(`proof length must be <= ${MERKLE_DEPTH}`);
  }

  return Number(normalized);
}

export function normalizeField(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("field values must be integers");
    }

    return BigInt(value);
  }

  if (typeof value === "string") {
    if (!isNumericString(value)) {
      throw new TypeError(`field value is not numeric: ${value}`);
    }

    return normalizeNonNegativeInteger(value);
  }

  throw new TypeError(`unsupported field value type: ${typeof value}`);
}

export function normalizeBytes32Input(value) {
  if (typeof value === "bigint" || typeof value === "number") {
    return toBeHex(normalizeNonNegativeInteger(value), 32);
  }

  if (typeof value === "string") {
    if (isNumericString(value)) {
      return toBeHex(normalizeNonNegativeInteger(value), 32);
    }

    return encodeBytes32String(value);
  }

  throw new TypeError(`unsupported bytes32 value type: ${typeof value}`);
}

export function encodePublicMessage(value) {
  if (Array.isArray(value)) {
    if (value.length !== 2) {
      throw new RangeError("public messages must contain exactly 2 fields");
    }

    return value.map(normalizeField);
  }

  const normalized = normalizeBytes32Input(value);
  return [
    ethersToBigInt(`0x${normalized.slice(2, 34)}`),
    ethersToBigInt(`0x${normalized.slice(34)}`)
  ];
}

export function serializePublicMessage(value) {
  return encodePublicMessage(value).map((part) => part.toString());
}

export function hashScope(value) {
  return BigInt(keccak256(normalizeBytes32Input(value))) >> 8n;
}

export function identityCommitment(secret) {
  return hashTypedFieldArray(poseidon4Hasher, [IDENTITY_DOMAIN, secret, 0n, 0n]);
}

export function treeHash(left, right) {
  return hashTypedFieldArray(poseidon2Hasher, [left, right]);
}

export function deriveNullifier(secret, scopeHash) {
  return hashTypedFieldArray(poseidon4Hasher, [NULLIFIER_DOMAIN, secret, scopeHash, 0n]);
}

export function rootKey(groupId, root) {
  return hashTypedFieldArray(poseidon4Hasher, [ROOT_HISTORY_DOMAIN, groupId, root, 0n]);
}

export function memberSlotKey(groupId, leafIndex) {
  return hashTypedFieldArray(poseidon4Hasher, [MEMBER_SLOT_DOMAIN, groupId, leafIndex, 0n]);
}

export function memberCommitmentKey(groupId, commitment) {
  return hashTypedFieldArray(poseidon4Hasher, [MEMBER_COMMITMENT_DOMAIN, groupId, commitment, 0n]);
}

export function assertPaddedSiblings(proofLength, merkleProofSiblings) {
  const length = asLength(proofLength);
  if (!Array.isArray(merkleProofSiblings)) {
    throw new TypeError("merkleProofSiblings must be an array");
  }

  if (merkleProofSiblings.length !== MERKLE_DEPTH) {
    throw new RangeError(`expected exactly ${MERKLE_DEPTH} Merkle siblings`);
  }

  for (let i = length; i < MERKLE_DEPTH; i += 1) {
    if (normalizeField(merkleProofSiblings[i]) !== 0n) {
      throw new Error("padded sibling slots must be zero");
    }
  }
}

export function padSiblings(merkleProofSiblings) {
  if (!Array.isArray(merkleProofSiblings)) {
    throw new TypeError("merkleProofSiblings must be an array");
  }

  if (merkleProofSiblings.length > MERKLE_DEPTH) {
    throw new RangeError(`expected at most ${MERKLE_DEPTH} Merkle siblings`);
  }

  const padded = merkleProofSiblings.map(normalizeField);
  while (padded.length < MERKLE_DEPTH) {
    padded.push(0n);
  }

  return padded;
}

export function rebuildMerkleRoot(leaf, merkleProofLength, merkleProofIndex, merkleProofSiblings) {
  const length = asLength(merkleProofLength);
  const siblings = padSiblings(merkleProofSiblings);
  assertPaddedSiblings(length, siblings);

  let node = normalizeField(leaf);
  let indexCursor = normalizeField(merkleProofIndex);

  for (let i = 0; i < length; i += 1) {
    const sibling = siblings[i];
    node = indexCursor % 2n === 1n ? treeHash(sibling, node) : treeHash(node, sibling);
    indexCursor /= 2n;
  }

  return node;
}

export function rebuildExistingRootFromAppend(
  merkleProofLength,
  appendIndex,
  merkleProofSiblings
) {
  const length = asLength(merkleProofLength);
  const siblings = padSiblings(merkleProofSiblings);
  assertPaddedSiblings(length, siblings);

  let cursor = normalizeField(appendIndex);
  let node = EMPTY_ROOT;
  let hasNode = false;
  let consumedSiblings = 0;

  for (let level = 0; level < MERKLE_DEPTH; level += 1) {
    const sibling = siblings[level];
    if (cursor % 2n === 1n) {
      node = hasNode ? treeHash(sibling, node) : sibling;
      hasNode = true;
      consumedSiblings += 1;
    } else if (cursor > 0n && sibling !== 0n) {
      throw new Error("append witnesses must zero sibling slots for even levels");
    }

    if (cursor > 0n) {
      cursor /= 2n;
    } else if (sibling !== 0n) {
      throw new Error("append witnesses must zero padded sibling slots");
    }
  }

  if (consumedSiblings !== length) {
    throw new Error("append witness length does not match the append index");
  }

  return hasNode ? node : EMPTY_ROOT;
}

export function rebuildNextRootFromAppend(
  newCommitment,
  merkleProofLength,
  appendIndex,
  merkleProofSiblings
) {
  const length = asLength(merkleProofLength);
  const siblings = padSiblings(merkleProofSiblings);
  assertPaddedSiblings(length, siblings);

  let cursor = normalizeField(appendIndex);
  let node = normalizeField(newCommitment);
  let consumedSiblings = 0;

  for (let level = 0; level < MERKLE_DEPTH; level += 1) {
    const sibling = siblings[level];
    if (cursor % 2n === 1n) {
      node = treeHash(sibling, node);
      consumedSiblings += 1;
    } else if (cursor > 0n && sibling !== 0n) {
      throw new Error("append witnesses must zero sibling slots for even levels");
    }

    if (cursor > 0n) {
      cursor /= 2n;
    } else if (sibling !== 0n) {
      throw new Error("append witnesses must zero padded sibling slots");
    }
  }

  if (consumedSiblings !== length) {
    throw new Error("append witness length does not match the append index");
  }

  return node;
}

export function buildVerifierTuple(merkleRoot, nullifier, message, scopeInput) {
  return {
    merkleRoot: normalizeField(merkleRoot),
    nullifier: normalizeField(nullifier),
    message: encodePublicMessage(message),
    scopeHash: hashScope(scopeInput)
  };
}

export function asOrderedVerifierTuple(tuple) {
  const message = encodePublicMessage(tuple.message);
  return [
    normalizeField(tuple.merkleRoot),
    normalizeField(tuple.nullifier),
    message[0],
    message[1],
    normalizeField(tuple.scopeHash)
  ];
}

export function buildWitnessInputs({
  identitySecret,
  merkleRoot,
  merkleProofLength,
  merkleProofIndex,
  merkleProofSiblings,
  message,
  scope
}) {
  const paddedSiblings = padSiblings(merkleProofSiblings);
  const scopeHash = hashScope(scope);

  return {
    identitySecret: normalizeField(identitySecret),
    identityCommitment: identityCommitment(identitySecret),
    merkleRoot: normalizeField(merkleRoot),
    merkleProofLength: asLength(merkleProofLength),
    merkleProofIndex: normalizeField(merkleProofIndex),
    merkleProofSiblings: paddedSiblings,
    message: encodePublicMessage(message),
    scopeHash,
    nullifier: deriveNullifier(identitySecret, scopeHash)
  };
}

export function randomField() {
  return ethersToBigInt(`0x${randomBytes(31).toString("hex")}`);
}

export function ensureDistinctFromAleoAccountKey(value) {
  if (typeof value === "string" && value.startsWith("APrivateKey1")) {
    throw new Error("identity secrets must not reuse Aleo account private keys");
  }

  return value;
}

export function assertGroupCapacity(index) {
  const normalized = normalizeField(index);
  if (normalized >= BigInt(MAX_GROUP_SIZE)) {
    throw new RangeError(`group exceeds depth-${MERKLE_DEPTH} capacity`);
  }

  return normalized;
}
