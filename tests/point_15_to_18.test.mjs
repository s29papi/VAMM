import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_COMMITMENT_A,
  IDENTITY_COMMITMENT_B,
  IDENTITY_SECRET_A,
  IDENTITY_SECRET_B,
  MESSAGE_VOTE_YES,
  NULLIFIER_A,
  ROOT_AFTER_MEMBER_A,
  ROOT_AFTER_MEMBER_B,
  SCOPE_HASH_GROUP7_PROPOSAL1
} from "./fixtures.mjs";
import { createGroupState } from "../src/group-state.mjs";
import { createIdentity } from "../src/identity.mjs";
import { buildJoinRequest } from "../src/join-request.mjs";
import { buildAleoWitness, buildVerifierTupleFromWitness, rebuildPublicInputs } from "../src/witness-builder.mjs";

test("points 15 to 18 cover the Aleo identity wrapper, tree state, join payloads, and witness building", () => {
  const identityA = createIdentity(IDENTITY_SECRET_A);
  const identityB = createIdentity(IDENTITY_SECRET_B);

  assert.equal(identityA.commitment, IDENTITY_COMMITMENT_A);
  assert.equal(identityB.commitment, IDENTITY_COMMITMENT_B);
  assert.notEqual(createIdentity().identitySecret, identityA.identitySecret);
  assert.throws(() => createIdentity("APrivateKey1bad"), /must not reuse Aleo account private keys/);

  const serialized = identityA.serialize();
  const imported = createIdentity(serialized.identitySecret);
  assert.equal(imported.commitment, identityA.commitment);

  const group = createGroupState([identityA.commitment]);
  assert.equal(group.root, ROOT_AFTER_MEMBER_A);
  group.addMember(identityB.commitment);
  assert.equal(group.root, ROOT_AFTER_MEMBER_B);
  assert.equal(group.indexOf(identityB.commitment), 1);

  const proof = group.generateMerkleProof(1);
  assert.equal(proof.merkleProofLength, 1);
  assert.equal(proof.merkleProofIndex, 1n);
  assert.equal(group.verifyMerkleProof(proof), true);

  const joinRequest = buildJoinRequest({ groupId: 7, identityCommitment: identityB.commitment });
  assert.deepEqual(Object.keys(joinRequest), ["groupId", "identityCommitment"]);

  const witness = buildAleoWitness({
    groupId: 7,
    identity: identityA,
    group,
    message: "vote:yes",
    scope: "proposal:1:group:7"
  });
  assert.equal(witness.programId, "veil_semaphore_v1.aleo");
  assert.equal(witness.functionId, "validate_proof_depth_20");
  assert.equal(witness.groupId, "7");
  assert.equal(witness.merkleRoot, ROOT_AFTER_MEMBER_B.toString());
  assert.equal(witness.nullifier, NULLIFIER_A.toString());
  assert.deepEqual(witness.message, MESSAGE_VOTE_YES.map((value) => value.toString()));
  assert.equal(witness.scopeHash, SCOPE_HASH_GROUP7_PROPOSAL1.toString());

  const rebuilt = rebuildPublicInputs("vote:yes", "proposal:1:group:7");
  assert.deepEqual(rebuilt.message, witness.message);
  assert.equal(rebuilt.scopeHash, witness.scopeHash);
  assert.deepEqual(buildVerifierTupleFromWitness(witness), [
    ROOT_AFTER_MEMBER_B,
    NULLIFIER_A,
    MESSAGE_VOTE_YES[0],
    MESSAGE_VOTE_YES[1],
    SCOPE_HASH_GROUP7_PROPOSAL1
  ]);
});
