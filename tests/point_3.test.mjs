import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_VOTE_YES,
  SCOPE_HASH_GROUP7_PROPOSAL1
} from "./fixtures.mjs";
import {
  asOrderedVerifierTuple,
  buildVerifierTuple,
  encodePublicMessage,
  hashScope,
  normalizeBytes32Input
} from "../src/semantics.mjs";

test("point 3 uses the pinned public-message and hashed-scope preprocessing", () => {
  assert.equal(
    normalizeBytes32Input("vote:yes"),
    "0x766f74653a796573000000000000000000000000000000000000000000000000"
  );
  assert.deepEqual(encodePublicMessage("vote:yes"), MESSAGE_VOTE_YES);
  assert.equal(hashScope("proposal:1:group:7"), SCOPE_HASH_GROUP7_PROPOSAL1);

  const tuple = buildVerifierTuple(1n, 2n, "vote:yes", "proposal:1:group:7");
  assert.deepEqual(asOrderedVerifierTuple(tuple), [
    1n,
    2n,
    MESSAGE_VOTE_YES[0],
    MESSAGE_VOTE_YES[1],
    SCOPE_HASH_GROUP7_PROPOSAL1
  ]);
});
