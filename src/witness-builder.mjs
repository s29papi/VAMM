import { FUNCTION_ID, PROGRAM_ID } from "./constants.mjs";
import {
  asOrderedVerifierTuple,
  buildWitnessInputs,
  encodePublicMessage,
  hashScope,
  normalizeField
} from "./semantics.mjs";

export function buildAleoWitness({
  groupId,
  identity,
  group,
  message,
  scope
}) {
  const memberIndex = group.indexOf(identity.commitment);
  if (memberIndex < 0) {
    throw new Error("identity commitment is not a member of the group");
  }

  const merkleProof = group.generateMerkleProof(memberIndex);
  const witnessInputs = buildWitnessInputs({
    identitySecret: identity.identitySecret,
    merkleRoot: merkleProof.merkleRoot,
    merkleProofLength: merkleProof.merkleProofLength,
    merkleProofIndex: merkleProof.merkleProofIndex,
    merkleProofSiblings: merkleProof.merkleProofSiblings,
    message,
    scope
  });

  return {
    programId: PROGRAM_ID,
    functionId: FUNCTION_ID,
    groupId: normalizeField(groupId).toString(),
    merkleRoot: witnessInputs.merkleRoot.toString(),
    nullifier: witnessInputs.nullifier.toString(),
    message: witnessInputs.message.map((value) => value.toString()),
    scopeHash: witnessInputs.scopeHash.toString(),
    identitySecret: witnessInputs.identitySecret.toString(),
    merkleProofLength: witnessInputs.merkleProofLength.toString(),
    merkleProofIndex: witnessInputs.merkleProofIndex.toString(),
    merkleProofSiblings: witnessInputs.merkleProofSiblings.map((value) => value.toString()),
    membershipIndex: memberIndex,
    identityCommitment: witnessInputs.identityCommitment.toString()
  };
}

export function buildVerifierTupleFromWitness(witness) {
  return asOrderedVerifierTuple({
    merkleRoot: witness.merkleRoot,
    nullifier: witness.nullifier,
    message: witness.message,
    scopeHash: witness.scopeHash
  });
}

export function rebuildPublicInputs(message, scope) {
  return {
    message: encodePublicMessage(message).map((value) => value.toString()),
    scopeHash: hashScope(scope).toString()
  };
}
