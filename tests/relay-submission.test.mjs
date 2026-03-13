import test from "node:test";
import assert from "node:assert/strict";

import {
  IDENTITY_SECRET_A,
  MESSAGE_VOTE_YES,
  ROOT_AFTER_MEMBER_A,
  SCOPE_HASH_GROUP7_PROPOSAL1
} from "./fixtures.mjs";
import { DEVNET_PRIVATE_KEY } from "../src/constants.mjs";
import { createIdentity } from "../src/identity.mjs";
import { createGroupState } from "../src/group-state.mjs";
import {
  buildLocalRelaySubmission,
  submitLocalRelaySubmission
} from "../src/relay-submission.mjs";

test("local relay submission builder proves locally and packages relay submission", async () => {
  const identity = createIdentity(IDENTITY_SECRET_A);
  const group = createGroupState([identity.commitment]);

  const programManager = {
    async buildExecutionTransaction(options) {
      assert.equal(options.programName, "veil_semaphore_v1.aleo");
      assert.equal(options.functionName, "validate_proof_depth_20");
      assert.equal(options.privateFee, false);
      assert.equal(options.inputs[0], "7u64");
      assert.equal(options.inputs[1], `${ROOT_AFTER_MEMBER_A}field`);
      assert.equal(
        options.inputs[3],
        `[${MESSAGE_VOTE_YES[0]}field, ${MESSAGE_VOTE_YES[1]}field]`
      );
      assert.equal(options.inputs[4], `${SCOPE_HASH_GROUP7_PROPOSAL1}field`);

      return {
        toString() {
          return "at1locallybuilt";
        }
      };
    }
  };

  const submission = await buildLocalRelaySubmission({
    groupId: 7,
    identity,
    group,
    message: "vote:yes",
    scope: "proposal:1:group:7",
    relayDeadline: 4_102_444_800n,
    relayNonce: 9n,
    provingPrivateKey: DEVNET_PRIVATE_KEY,
    programManager
  });

  assert.deepEqual(submission.executionPackage.message, MESSAGE_VOTE_YES.map(String));
  assert.equal(submission.executionPackage.scopeHash, SCOPE_HASH_GROUP7_PROPOSAL1.toString());
  assert.equal(submission.executionRequest.submissionMode, "relay");
  assert.equal(submission.relayAuthorization.nonce, "9");
  assert.equal(submission.transaction, "at1locallybuilt");
  assert.equal(submission.feeMode, "public-sponsored");
});

test("local relay submission builder can use explicit devnode execution mode", async () => {
  const identity = createIdentity(IDENTITY_SECRET_A);
  const group = createGroupState([identity.commitment]);
  let calledDevnodeBuilder = false;

  const programManager = {
    async buildDevnodeExecutionTransaction() {
      calledDevnodeBuilder = true;
      return {
        toString() {
          return "at1devnodebuilt";
        }
      };
    }
  };

  const submission = await buildLocalRelaySubmission({
    groupId: 7,
    identity,
    group,
    message: "vote:yes",
    scope: "proposal:1:group:7",
    relayDeadline: 4_102_444_800n,
    relayNonce: 10n,
    provingPrivateKey: DEVNET_PRIVATE_KEY,
    devnode: true,
    programManager
  });

  assert.equal(calledDevnodeBuilder, true);
  assert.equal(submission.transaction, "at1devnodebuilt");
});

test("local relay submission client posts the prepared bundle to the relayer", async () => {
  const result = await submitLocalRelaySubmission(
    "http://relayer.example",
    { transaction: "at1artifact" },
    async (url, options) => {
      assert.equal(url, "http://relayer.example/relay");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { transaction: "at1artifact" });

      return {
        ok: true,
        async json() {
          return { result: { transactionId: "at1submitted" } };
        }
      };
    }
  );

  assert.deepEqual(result, { transactionId: "at1submitted" });
});
