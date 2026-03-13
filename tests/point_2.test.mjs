import test from "node:test";
import assert from "node:assert/strict";

import manifest from "../artifact-manifest.json" with { type: "json" };
import { validateManifest } from "../src/manifest.mjs";

test("point 2 manifest records the fixed semantic profile", () => {
  assert.equal(validateManifest(manifest), true);
  assert.deepEqual(manifest.aleo_v1_profile.supported_depths, [20]);
  assert.deepEqual(
    manifest.aleo_v1_profile.verifier_public_tuple,
    ["merkleRoot", "nullifier", "message[0]", "message[1]", "scopeHash"]
  );
  assert.equal(manifest.aleo_v1_profile.message_representation, "public_split128_bytes32");
  assert.equal(
    manifest.aleo_v1_profile.scope_representation,
    "keccak256(bytes32(normalized_scope)) >> 8"
  );
  assert.equal(manifest.aleo_v1_profile.tree_model, "padded_lean_imt");
  assert.equal(manifest.aleo_v1_profile.batch_insertion, false);
  assert.equal(manifest.aleo_v1_profile.member_removal_semantics, "replace_leaf_with_zero");
  assert.equal(manifest.aleo_v1_profile.root_history_policy, "retain_all");
});
