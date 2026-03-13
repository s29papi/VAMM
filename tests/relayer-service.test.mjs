import test from "node:test";
import assert from "node:assert/strict";

import { DEVNET_PRIVATE_KEY } from "../src/constants.mjs";
import { buildExecutionPackage } from "../src/execution-package.mjs";
import { buildExecutionRequest } from "../src/execution-request.mjs";
import {
  assertRelayAuthorizationMatchesPackage,
  buildRelayAuthorization,
  signRelayAuthorization,
  verifySignedRelayAuthorization
} from "../src/relayer-authorization.mjs";
import { AleoVeilRelayerService } from "../src/relayer-service.mjs";
import { createRelayerServer } from "../src/relayer-server.mjs";
import {
  MESSAGE_VOTE_YES,
  NULLIFIER_A,
  ROOT_AFTER_MEMBER_A,
  SCOPE_HASH_GROUP7_PROPOSAL1
} from "./fixtures.mjs";

function buildValidRelaySubmission(overrides = {}) {
  const executionPackage =
    overrides.executionPackage ??
    buildExecutionPackage({
      groupId: 7,
      merkleRoot: ROOT_AFTER_MEMBER_A,
      nullifier: NULLIFIER_A,
      message: MESSAGE_VOTE_YES,
      scopeHash: SCOPE_HASH_GROUP7_PROPOSAL1
    });

  const relayAuthorization =
    overrides.relayAuthorization ??
    buildRelayAuthorization({
      groupId: executionPackage.groupId,
      merkleRoot: executionPackage.merkleRoot,
      nullifier: executionPackage.nullifier,
      message: executionPackage.message,
      scopeHash: executionPackage.scopeHash,
      deadline: 4_102_444_800n,
      nonce: 1n
    });

  const signatureBundle =
    overrides.signatureBundle ?? signRelayAuthorization(DEVNET_PRIVATE_KEY, relayAuthorization);

  return {
    executionPackage,
    executionRequest: overrides.executionRequest ?? buildExecutionRequest(executionPackage),
    relayAuthorization,
    relayAuthorizationSignature:
      overrides.relayAuthorizationSignature ?? signatureBundle.signature,
    signerAddress: overrides.signerAddress ?? signatureBundle.signerAddress,
    transaction: overrides.transaction ?? "at1mocktransaction",
    feeMode: overrides.feeMode ?? "private-sponsored"
  };
}

test("relayer authorization signatures are deterministic and verifiable", () => {
  const submission = buildValidRelaySubmission();

  assert.equal(
    assertRelayAuthorizationMatchesPackage(submission.relayAuthorization, submission.executionPackage)
      .nonce,
    "1"
  );

  const verification = verifySignedRelayAuthorization({
    authorization: submission.relayAuthorization,
    signature: submission.relayAuthorizationSignature,
    signerAddress: submission.signerAddress
  });

  assert.equal(verification.signerAddress, submission.signerAddress);
});

test("relayer service accepts a valid relay-only private-sponsored submission", async () => {
  const networkClient = {
    async getProgramMappingValue() {
      return null;
    },
    async submitTransaction(transaction) {
      assert.equal(transaction, "at1mocktransaction");
      return "at1submitted";
    },
    async waitForTransactionConfirmation(transactionId) {
      assert.equal(transactionId, "at1submitted");
      return { id: transactionId, status: "accepted" };
    }
  };

  const service = new AleoVeilRelayerService({
    networkClient,
    clock: () => 1_700_000_000
  });

  const submission = buildValidRelaySubmission();
  const result = await service.submit(submission);

  assert.equal(result.transactionId, "at1submitted");
  assert.equal(result.signerAddress, submission.signerAddress);
  assert.equal(result.feeMode, "private-sponsored");

  await assert.rejects(() => service.validateSubmission(submission), /nonce already used/);
});

test("relayer service rejects direct submission, public-sponsored fees, used nullifiers, and bad signatures", async () => {
  const service = new AleoVeilRelayerService({
    networkClient: {
      async getProgramMappingValue() {
        return null;
      }
    },
    waitForConfirmation: false,
    clock: () => 1_700_000_000
  });

  const validSubmission = buildValidRelaySubmission();

  await assert.rejects(
    () =>
      service.validateSubmission({
        ...validSubmission,
        executionRequest: {
          ...validSubmission.executionRequest,
          submissionMode: "direct"
        }
      }),
    /direct participant submission/
  );

  await assert.rejects(
    () =>
      service.validateSubmission({
        ...validSubmission,
        feeMode: "public-sponsored"
      }),
    /private-sponsored fee mode/
  );

  const mismatchedSignature = signRelayAuthorization(
    DEVNET_PRIVATE_KEY,
    {
      ...validSubmission.relayAuthorization,
      deadline: 4_102_444_801n
    }
  );

  await assert.rejects(
    () =>
      service.validateSubmission({
        ...validSubmission,
        relayAuthorizationSignature: mismatchedSignature.signature
      }),
    /invalid relay authorization signature/
  );

  const nullifierUsedService = new AleoVeilRelayerService({
    networkClient: {
      async getProgramMappingValue() {
        return "true";
      }
    },
    clock: () => 1_700_000_000
  });

  await assert.rejects(
    () => nullifierUsedService.validateSubmission(validSubmission),
    /nullifier already used on-chain/
  );
});

test("relayer service rejects message substitution and expired relay authorizations", async () => {
  const service = new AleoVeilRelayerService({
    networkClient: {
      async getProgramMappingValue() {
        return null;
      }
    },
    waitForConfirmation: false,
    clock: () => 1_700_000_000
  });

  const validSubmission = buildValidRelaySubmission();

  const tamperedPackage = {
    ...validSubmission.executionPackage,
    message: ["1", "2"]
  };

  await assert.rejects(
    () =>
      service.validateSubmission({
        ...validSubmission,
        executionPackage: tamperedPackage,
        executionRequest: buildExecutionRequest(tamperedPackage)
      }),
    /relay authorization message does not match/
  );

  const expiredAuthorization = {
    ...validSubmission.relayAuthorization,
    deadline: 1n
  };
  const expiredSignature = signRelayAuthorization(DEVNET_PRIVATE_KEY, expiredAuthorization);

  await assert.rejects(
    () =>
      service.validateSubmission({
        ...validSubmission,
        relayAuthorization: expiredAuthorization,
        relayAuthorizationSignature: expiredSignature.signature
      }),
    /deadline has expired/
  );
});

test("relayer server exposes health and relay endpoints", async (t) => {
  const service = {
    feeMode: "private-sponsored",
    waitForConfirmation: false,
    async submit(submission) {
      assert.equal(submission.executionPackage.groupId, "7");
      return { transactionId: "at1server", feeMode: "private-sponsored" };
    }
  };

  const server = createRelayerServer({ service });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
  });

  const { port } = server.address();

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    feeMode: "private-sponsored",
    waitForConfirmation: false
  });

  const relayResponse = await fetch(`http://127.0.0.1:${port}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      executionPackage: buildValidRelaySubmission().executionPackage
    })
  });

  assert.equal(relayResponse.status, 200);
  assert.deepEqual(await relayResponse.json(), {
    ok: true,
    result: {
      transactionId: "at1server",
      feeMode: "private-sponsored"
    }
  });
});
