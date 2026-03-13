import { FUNCTION_ID, PROGRAM_ID, VERIFIER_PUBLIC_TUPLE } from "./constants.mjs";
import { encodePublicMessage, hashScope, normalizeField } from "./semantics.mjs";

export function buildExecutionPackage({
  groupId,
  merkleRoot,
  nullifier,
  message,
  scope,
  scopeHash,
  executionId
}) {
  const encodedMessage = encodePublicMessage(message);
  const normalizedScopeHash = scopeHash === undefined ? hashScope(scope) : normalizeField(scopeHash);

  return {
    programId: PROGRAM_ID,
    functionId: FUNCTION_ID,
    groupId: normalizeField(groupId).toString(),
    merkleRoot: normalizeField(merkleRoot).toString(),
    nullifier: normalizeField(nullifier).toString(),
    message: encodedMessage.map((value) => value.toString()),
    scopeHash: normalizedScopeHash.toString(),
    typedPublicInputs: [
      {
        name: "groupId",
        type: "u64",
        visibility: "public",
        value: normalizeField(groupId).toString()
      },
      {
        name: "merkleRoot",
        type: "field",
        visibility: "public",
        value: normalizeField(merkleRoot).toString()
      },
      {
        name: "nullifier",
        type: "field",
        visibility: "public",
        value: normalizeField(nullifier).toString()
      },
      {
        name: "message[0]",
        type: "field",
        visibility: "public",
        value: encodedMessage[0].toString()
      },
      {
        name: "message[1]",
        type: "field",
        visibility: "public",
        value: encodedMessage[1].toString()
      },
      {
        name: "scopeHash",
        type: "field",
        visibility: "public",
        value: normalizedScopeHash.toString()
      }
    ],
    verifierTupleOrder: [...VERIFIER_PUBLIC_TUPLE],
    executionId: executionId ?? null
  };
}

export function serializeExecutionPackage(pkg) {
  return JSON.stringify(pkg);
}

export function deserializeExecutionPackage(payload) {
  return JSON.parse(payload);
}
