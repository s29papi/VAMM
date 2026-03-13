import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_COMMITMENT_A,
  IDENTITY_COMMITMENT_B,
  PROOF_INDEX_A,
  PROOF_INDEX_B,
  PROOF_LENGTH_A,
  PROOF_LENGTH_B,
  PROOF_SIBLINGS_A_PADDED,
  PROOF_SIBLINGS_B_PADDED,
  ROOT_AFTER_MEMBER_A,
  ROOT_AFTER_MEMBER_B
} from "./fixtures.mjs";
import { createIdentity } from "../src/identity.mjs";
import { AleoSemaphorePortState } from "../src/port-state.mjs";

test("points 4 to 13 cover initialization, groups, members, and root history", () => {
  const owner = "aleo1owner";
  const admin = "aleo1admin";
  const state = new AleoSemaphorePortState();

  assert.equal(state.initialized, false);
  state.initialize(owner);
  assert.equal(state.initialized, true);
  assert.equal(state.owner, owner);
  assert.throws(() => state.initialize("aleo1other"), /already initialized/);

  assert.throws(() => state.transferOwnership("aleo1intruder", admin), /not the owner/);
  state.transferOwnership(owner, admin);
  assert.equal(state.owner, admin);

  const created = state.createGroup({ caller: admin, groupId: 7, admin });
  assert.deepEqual(created, {
    groupId: "7",
    admin,
    merkleDepth: 20,
    activeMembers: 0,
    nextIndex: 0,
    root: "0"
  });
  assert.equal(state.hasHistoricalRoot(7, 0n), true);
  assert.throws(() => state.createGroup({ caller: admin, groupId: 7, admin }), /already exists/);

  assert.throws(
    () => state.setGroupAdmin({ caller: owner, groupId: 7, nextAdmin: owner }),
    /not the group admin/
  );
  state.setGroupAdmin({ caller: admin, groupId: 7, nextAdmin: owner });
  assert.equal(state.getGroupAdmin(7), owner);

  const firstAppend = state.addMember({
    caller: owner,
    groupId: 7,
    newCommitment: IDENTITY_COMMITMENT_A,
    currentRoot: 0n,
    merkleProofLength: PROOF_LENGTH_A,
    merkleProofIndex: PROOF_INDEX_A,
    merkleProofSiblings: PROOF_SIBLINGS_A_PADDED
  });
  assert.equal(firstAppend.root, ROOT_AFTER_MEMBER_A.toString());
  assert.equal(firstAppend.activeMembers, 1);
  assert.equal(firstAppend.nextIndex, 1);
  assert.equal(state.hasHistoricalRoot(7, ROOT_AFTER_MEMBER_A), true);

  const secondAppend = state.addMember({
    caller: owner,
    groupId: 7,
    newCommitment: IDENTITY_COMMITMENT_B,
    currentRoot: ROOT_AFTER_MEMBER_A,
    merkleProofLength: PROOF_LENGTH_B,
    merkleProofIndex: PROOF_INDEX_B,
    merkleProofSiblings: PROOF_SIBLINGS_B_PADDED
  });
  assert.equal(secondAppend.root, ROOT_AFTER_MEMBER_B.toString());
  assert.equal(secondAppend.activeMembers, 2);
  assert.equal(secondAppend.nextIndex, 2);
  assert.equal(state.hasHistoricalRoot(7, ROOT_AFTER_MEMBER_B), true);

  const replacementIdentity = createIdentity(222222222n);
  const updateProof = state.getGroup(7).generateMerkleProof(1);
  const updated = state.updateMember({
    caller: owner,
    groupId: 7,
    leafIndex: 1,
    oldCommitment: IDENTITY_COMMITMENT_B,
    newCommitment: replacementIdentity.commitment,
    currentRoot: ROOT_AFTER_MEMBER_B,
    merkleProofLength: updateProof.merkleProofLength,
    merkleProofIndex: updateProof.merkleProofIndex,
    merkleProofSiblings: updateProof.merkleProofSiblings
  });
  assert.equal(updated.activeMembers, 2);
  assert.equal(updated.nextIndex, 2);

  const removeProof = state.getGroup(7).generateMerkleProof(1);
  const removed = state.removeMember({
    caller: owner,
    groupId: 7,
    leafIndex: 1,
    oldCommitment: replacementIdentity.commitment,
    currentRoot: state.getGroup(7).root,
    merkleProofLength: removeProof.merkleProofLength,
    merkleProofIndex: removeProof.merkleProofIndex,
    merkleProofSiblings: removeProof.merkleProofSiblings
  });
  assert.equal(removed.activeMembers, 1);
  assert.equal(removed.nextIndex, 2);
  assert.equal(state.getGroup(7).memberAt(1), 0n);

  assert.throws(
    () =>
      state.removeMember({
        caller: owner,
        groupId: 7,
        leafIndex: 1,
        oldCommitment: replacementIdentity.commitment,
        currentRoot: state.getGroup(7).root,
        merkleProofLength: removeProof.merkleProofLength,
        merkleProofIndex: removeProof.merkleProofIndex,
        merkleProofSiblings: removeProof.merkleProofSiblings
      }),
    /old commitment does not match/
  );
});
