import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_COMMITMENT_A, ROOT_AFTER_MEMBER_A } from "./fixtures.mjs";
import { AleoSemaphorePortState } from "../src/port-state.mjs";
import {
  memberCommitmentKey,
  memberSlotKey,
  rootKey
} from "../src/semantics.mjs";

test("point 14 exposes the full mapping query surface", () => {
  const state = new AleoSemaphorePortState();
  state.initialize("aleo1owner");
  state.createGroup({ caller: "aleo1owner", groupId: 7, admin: "aleo1owner" });
  state.addMember({
    caller: "aleo1owner",
    groupId: 7,
    newCommitment: IDENTITY_COMMITMENT_A,
    currentRoot: 0n,
    merkleProofLength: 0,
    merkleProofIndex: 0n,
    merkleProofSiblings: Array.from({ length: 20 }, () => 0n)
  });

  assert.equal(state.getMappingValue("initialized", "0"), true);
  assert.equal(state.getMappingValue("program_admin", "0"), "aleo1owner");
  assert.equal(state.getMappingValue("group_exists", "7"), true);
  assert.equal(state.getMappingValue("group_admin", "7"), "aleo1owner");
  assert.equal(state.getMappingValue("group_depth", "7"), 20);
  assert.equal(state.getMappingValue("group_active_members", "7"), 1);
  assert.equal(state.getMappingValue("group_next_index", "7"), 1);
  assert.equal(state.getMappingValue("group_root", "7"), ROOT_AFTER_MEMBER_A.toString());
  assert.equal(
    state.getMappingValue("group_root_valid", rootKey(7, ROOT_AFTER_MEMBER_A).toString()),
    true
  );
  assert.equal(
    state.getMappingValue("group_member", memberSlotKey(7, 0).toString()),
    IDENTITY_COMMITMENT_A.toString()
  );
  assert.equal(
    state.getMappingValue(
      "group_member_index",
      memberCommitmentKey(7, IDENTITY_COMMITMENT_A).toString()
    ),
    0
  );
  assert.equal(
    state.getMappingValue(
      "group_commitment_active",
      memberCommitmentKey(7, IDENTITY_COMMITMENT_A).toString()
    ),
    true
  );
  assert.equal(state.getMappingValue("nullifier_used", "999"), undefined);
});
