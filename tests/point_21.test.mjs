import test from "node:test";
import assert from "node:assert/strict";

import { MESSAGE_VOTE_YES, SCOPE_HASH_GROUP7_PROPOSAL1 } from "./fixtures.mjs";
import { assertRelayAuthorizationShape, buildRelayAuthorization } from "../src/relayer-authorization.mjs";

test("point 21 relay authorization uses the fixed off-chain payload", () => {
  const authorization = buildRelayAuthorization({
    groupId: 1,
    merkleRoot: 10,
    nullifier: 20,
    message: "vote:yes",
    scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1,
    deadline: 999,
    nonce: 7
  });

  assert.equal(assertRelayAuthorizationShape(authorization), true);
  assert.equal(authorization.program_id, "veil_semaphore_v1.aleo");
  assert.equal(authorization.function_id, "validate_proof_depth_20");
  assert.deepEqual(authorization.message, MESSAGE_VOTE_YES.map((value) => value.toString()));
  assert.equal(authorization.scope_hash, SCOPE_HASH_GROUP7_PROPOSAL1.toString());
});
