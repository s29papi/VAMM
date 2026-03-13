import test from "node:test";
import assert from "node:assert/strict";

import manifest from "../artifact-manifest.json" with { type: "json" };
import {
  FUNCTION_ID,
  MERKLE_DEPTH,
  PROGRAM_ID,
  UPSTREAM_ARTIFACT_VERSION,
  UPSTREAM_VERSION,
  VERIFIER_PUBLIC_TUPLE
} from "../src/constants.mjs";

test("point 1 pins the semantic upstream and Aleo baseline", () => {
  assert.equal(UPSTREAM_VERSION, "v4.13.0");
  assert.equal(UPSTREAM_ARTIFACT_VERSION, "4.13.0");
  assert.equal(MERKLE_DEPTH, 20);
  assert.equal(PROGRAM_ID, manifest.aleo_v1_profile.program_id);
  assert.equal(FUNCTION_ID, manifest.aleo_v1_profile.function_id);
  assert.deepEqual(VERIFIER_PUBLIC_TUPLE, [
    "merkleRoot",
    "nullifier",
    "message[0]",
    "message[1]",
    "scopeHash"
  ]);
});
