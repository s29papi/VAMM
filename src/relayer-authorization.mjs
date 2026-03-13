import { TextEncoder } from "node:util";

import { Address, PrivateKey, Signature } from "@provablehq/sdk";

import { FUNCTION_ID, PROGRAM_ID, RELAY_AUTHORIZATION_FIELDS } from "./constants.mjs";
import { encodePublicMessage, hashScope, normalizeField } from "./semantics.mjs";

const textEncoder = new TextEncoder();

function asPrivateKey(privateKey) {
  if (typeof privateKey === "string") {
    return PrivateKey.from_string(privateKey);
  }

  if (privateKey?.constructor?.name === "PrivateKey") {
    return privateKey;
  }

  throw new TypeError("relay authorization signing requires an Aleo private key");
}

function asSignature(signature) {
  if (typeof signature === "string") {
    return Signature.from_string(signature);
  }

  if (signature?.constructor?.name === "Signature") {
    return signature;
  }

  throw new TypeError("relay authorization signature must be a string or Signature");
}

export function buildRelayAuthorization({
  groupId,
  merkleRoot,
  nullifier,
  message,
  scope,
  scopeHash,
  deadline,
  nonce
}) {
  return {
    program_id: PROGRAM_ID,
    function_id: FUNCTION_ID,
    group_id: normalizeField(groupId).toString(),
    merkle_root: normalizeField(merkleRoot).toString(),
    nullifier: normalizeField(nullifier).toString(),
    message: encodePublicMessage(message).map((value) => value.toString()),
    scope_hash: scopeHash === undefined ? hashScope(scope).toString() : normalizeField(scopeHash).toString(),
    deadline: normalizeField(deadline).toString(),
    nonce: normalizeField(nonce).toString()
  };
}

export function assertRelayAuthorizationShape(authorization) {
  if (authorization === null || typeof authorization !== "object" || Array.isArray(authorization)) {
    throw new TypeError("relay authorization must be an object");
  }

  const keys = Object.keys(authorization).sort();
  const expected = [...RELAY_AUTHORIZATION_FIELDS].sort();

  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error(`relay authorization fields mismatch: ${keys.join(",")}`);
  }

  if (!Array.isArray(authorization.message) || authorization.message.length !== 2) {
    throw new Error("relay authorization must carry a 2-field public message");
  }

  return true;
}

export function normalizeRelayAuthorization(authorization) {
  assertRelayAuthorizationShape(authorization);

  return {
    program_id: String(authorization.program_id),
    function_id: String(authorization.function_id),
    group_id: normalizeField(authorization.group_id).toString(),
    merkle_root: normalizeField(authorization.merkle_root).toString(),
    nullifier: normalizeField(authorization.nullifier).toString(),
    message: encodePublicMessage(authorization.message).map((value) => value.toString()),
    scope_hash: normalizeField(authorization.scope_hash).toString(),
    deadline: normalizeField(authorization.deadline).toString(),
    nonce: normalizeField(authorization.nonce).toString()
  };
}

export function canonicalizeRelayAuthorization(authorization) {
  const normalized = normalizeRelayAuthorization(authorization);
  const ordered = {};

  for (const field of RELAY_AUTHORIZATION_FIELDS) {
    ordered[field] = normalized[field];
  }

  return JSON.stringify(ordered);
}

export function encodeRelayAuthorizationForSigning(authorization) {
  return textEncoder.encode(canonicalizeRelayAuthorization(authorization));
}

export function assertRelayAuthorizationMatchesPackage(authorization, executionPackage) {
  const normalized = normalizeRelayAuthorization(authorization);

  const expected = {
    program_id: executionPackage.programId,
    function_id: executionPackage.functionId,
    group_id: normalizeField(executionPackage.groupId).toString(),
    merkle_root: normalizeField(executionPackage.merkleRoot).toString(),
    nullifier: normalizeField(executionPackage.nullifier).toString(),
    message: encodePublicMessage(executionPackage.message).map((value) => value.toString()),
    scope_hash: normalizeField(executionPackage.scopeHash).toString()
  };

  for (const [field, value] of Object.entries(expected)) {
    if (JSON.stringify(normalized[field]) !== JSON.stringify(value)) {
      throw new Error(`relay authorization ${field} does not match the execution package`);
    }
  }

  if (normalized.program_id !== PROGRAM_ID) {
    throw new Error(`unexpected relay authorization program id: ${normalized.program_id}`);
  }

  if (normalized.function_id !== FUNCTION_ID) {
    throw new Error(`unexpected relay authorization function id: ${normalized.function_id}`);
  }

  return normalized;
}

export function signRelayAuthorization(privateKey, authorization) {
  const signerPrivateKey = asPrivateKey(privateKey);
  const signature = signerPrivateKey.sign(encodeRelayAuthorizationForSigning(authorization));

  return {
    signature: signature.to_string(),
    signerAddress: signature.to_address().to_string(),
    canonicalAuthorization: canonicalizeRelayAuthorization(authorization)
  };
}

export function verifySignedRelayAuthorization({
  authorization,
  signature,
  signerAddress
}) {
  const signatureObject = asSignature(signature);
  const recoveredSignerAddress = signatureObject.to_address().to_string();

  if (signerAddress !== undefined && signerAddress !== recoveredSignerAddress) {
    throw new Error("relay authorization signer mismatch");
  }

  const address = Address.from_string(recoveredSignerAddress);
  const isValid = signatureObject.verify(address, encodeRelayAuthorizationForSigning(authorization));

  if (!isValid) {
    throw new Error("invalid relay authorization signature");
  }

  return {
    signerAddress: recoveredSignerAddress,
    canonicalAuthorization: canonicalizeRelayAuthorization(authorization),
    signature: signatureObject
  };
}
