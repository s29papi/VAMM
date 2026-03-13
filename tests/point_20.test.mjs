import test from "node:test";
import assert from "node:assert/strict";

import { MESSAGE_VOTE_YES, SCOPE_HASH_GROUP7_PROPOSAL1 } from "./fixtures.mjs";
import {
  buildExecutionPackage,
  deserializeExecutionPackage,
  serializeExecutionPackage
} from "../src/execution-package.mjs";

test("point 20 execution package keeps only public transport fields", () => {
  const pkg = buildExecutionPackage({
    groupId: 1,
    merkleRoot: 10,
    nullifier: 20,
    message: "vote:yes",
    scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1
  });

  assert.deepEqual(Object.keys(pkg), [
    "programId",
    "functionId",
    "groupId",
    "merkleRoot",
    "nullifier",
    "message",
    "scopeHash",
    "typedPublicInputs",
    "verifierTupleOrder",
    "executionId"
  ]);
  assert.deepEqual(pkg.message, MESSAGE_VOTE_YES.map((value) => value.toString()));
  assert.equal(pkg.scopeHash, SCOPE_HASH_GROUP7_PROPOSAL1.toString());
  assert.equal(pkg.typedPublicInputs.length, 6);
  assert.equal(pkg.typedPublicInputs[3].name, "message[0]");
  assert.equal(pkg.typedPublicInputs[4].name, "message[1]");

  const roundTrip = deserializeExecutionPackage(serializeExecutionPackage(pkg));
  assert.deepEqual(roundTrip, pkg);
});
