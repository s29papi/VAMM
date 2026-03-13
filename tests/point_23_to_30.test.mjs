import test from "node:test";
import assert from "node:assert/strict";

import manifest from "../artifact-manifest.json" with { type: "json" };
import {
  IDENTITY_SECRET_A,
  MESSAGE_VOTE_YES,
  NULLIFIER_A,
  PROOF_INDEX_A,
  PROOF_LENGTH_A,
  PROOF_SIBLINGS_A_PADDED,
  ROOT_AFTER_MEMBER_A,
  SCOPE_HASH_GROUP7_PROPOSAL1
} from "./fixtures.mjs";
import { buildDeploymentConfig, resolveDepthRoute } from "../src/deployment-config.mjs";
import { buildExecutionPackage } from "../src/execution-package.mjs";
import { assertExecutionRequestMatchesPackage, buildExecutionRequest } from "../src/execution-request.mjs";
import { validateManifest } from "../src/manifest.mjs";
import { AleoSemaphorePortState } from "../src/port-state.mjs";

test("points 23 to 30 cover routing, request shape, nullifiers, roots, and replay rejection", () => {
  assert.equal(validateManifest(manifest), true);

  const tampered = structuredClone(manifest);
  tampered.aleo_v1_profile.program_id = "wrong.aleo";
  assert.throws(() => validateManifest(tampered), /unexpected program id/);

  const executionPackage = buildExecutionPackage({
    groupId: 7,
    merkleRoot: ROOT_AFTER_MEMBER_A,
    nullifier: NULLIFIER_A,
    message: MESSAGE_VOTE_YES,
    scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1
  });
  const request = buildExecutionRequest(executionPackage);
  assert.equal(assertExecutionRequestMatchesPackage(request, executionPackage), true);

  const config = buildDeploymentConfig();
  assert.deepEqual(resolveDepthRoute(20, config), {
    programId: "veil_semaphore_v1.aleo",
    functionId: "validate_proof_depth_20"
  });
  assert.throws(() => resolveDepthRoute(19, config), /unsupported Merkle depth/);

  const state = new AleoSemaphorePortState();
  state.initialize("aleo1owner");
  state.createGroup({ caller: "aleo1owner", groupId: 7, admin: "aleo1owner" });
  state.addMember({
    caller: "aleo1owner",
    groupId: 7,
    newCommitment: ROOT_AFTER_MEMBER_A,
    currentRoot: 0n,
    merkleProofLength: 0,
    merkleProofIndex: 0n,
    merkleProofSiblings: PROOF_SIBLINGS_A_PADDED
  });

  assert.equal(state.validateRoot({ groupId: 7, root: ROOT_AFTER_MEMBER_A }), true);
  assert.equal(state.validateRoot({ groupId: 7, root: 12345n }), false);

  const validated = state.validateProof({
    groupId: 7,
    merkleRoot: ROOT_AFTER_MEMBER_A,
    nullifier: NULLIFIER_A,
    message: MESSAGE_VOTE_YES,
    scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1,
    identitySecret: IDENTITY_SECRET_A,
    merkleProofLength: PROOF_LENGTH_A,
    merkleProofIndex: PROOF_INDEX_A,
    merkleProofSiblings: PROOF_SIBLINGS_A_PADDED
  });
  assert.equal(validated.nullifier, NULLIFIER_A.toString());
  assert.equal(state.isNullifierUsed(NULLIFIER_A), true);

  assert.throws(
    () =>
      state.validateProof({
        groupId: 7,
        merkleRoot: ROOT_AFTER_MEMBER_A,
        nullifier: NULLIFIER_A,
        message: MESSAGE_VOTE_YES,
        scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1,
        identitySecret: IDENTITY_SECRET_A,
        merkleProofLength: PROOF_LENGTH_A,
        merkleProofIndex: PROOF_INDEX_A,
        merkleProofSiblings: PROOF_SIBLINGS_A_PADDED
      }),
    /already used/
  );
});
