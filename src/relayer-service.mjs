import { AleoNetworkClient } from "@provablehq/sdk";

import { FUNCTION_ID, PROGRAM_ID } from "./constants.mjs";
import { buildExecutionRequest, assertExecutionRequestMatchesPackage } from "./execution-request.mjs";
import {
  assertRelayAuthorizationMatchesPackage,
  verifySignedRelayAuthorization
} from "./relayer-authorization.mjs";
import { normalizeField } from "./semantics.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(name, value) {
  if (!isObject(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function isMissingMappingError(error) {
  return /404|not found|does not exist|missing/i.test(String(error?.message ?? error));
}

function isTruthyMappingValue(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return /^true\b/i.test(value.trim());
  }

  return Boolean(value);
}

function normalizeTransaction(transaction) {
  if (transaction === undefined || transaction === null) {
    return null;
  }

  if (typeof transaction === "string") {
    if (transaction.trim() === "") {
      throw new Error("transaction must not be empty");
    }

    return transaction;
  }

  if (typeof transaction.toString === "function") {
    return transaction;
  }

  throw new TypeError("transaction must be a string or Transaction-like object");
}

export class AleoVeilRelayerService {
  constructor({
    networkClient,
    networkHost,
    waitForConfirmation = true,
    confirmationIntervalMs = 2_000,
    confirmationTimeoutMs = 45_000,
    feeMode = "private-sponsored",
    clock = () => Math.floor(Date.now() / 1_000),
    nullifierLookup = true,
    transactionValidator = null
  } = {}) {
    this.networkClient =
      networkClient ?? (networkHost ? new AleoNetworkClient(networkHost) : null);
    this.waitForConfirmation = waitForConfirmation;
    this.confirmationIntervalMs = confirmationIntervalMs;
    this.confirmationTimeoutMs = confirmationTimeoutMs;
    this.feeMode = feeMode;
    this.clock = clock;
    this.nullifierLookup = nullifierLookup;
    this.transactionValidator = transactionValidator;
    this.usedNonces = new Set();
    this.pendingNonces = new Set();
  }

  nonceKey(signerAddress, nonce) {
    return `${signerAddress}:${normalizeField(nonce).toString()}`;
  }

  async isNullifierUsedOnChain(nullifier) {
    if (!this.nullifierLookup || this.networkClient === null) {
      return false;
    }

    try {
      const value = await this.networkClient.getProgramMappingValue(
        PROGRAM_ID,
        "nullifier_used",
        `${normalizeField(nullifier)}field`
      );

      return isTruthyMappingValue(value);
    } catch (error) {
      if (isMissingMappingError(error)) {
        return false;
      }

      throw error;
    }
  }

  assertTransaction(transaction) {
    const normalized = normalizeTransaction(transaction);

    if (normalized !== null && this.transactionValidator !== null) {
      this.transactionValidator(normalized);
    }

    return normalized;
  }

  async validateSubmission(submission) {
    assertObject("submission", submission);
    assertObject("submission.executionPackage", submission.executionPackage);

    const executionPackage = submission.executionPackage;
    const executionRequest = submission.executionRequest ?? buildExecutionRequest(executionPackage);

    assertObject("submission.executionRequest", executionRequest);
    assertObject("submission.relayAuthorization", submission.relayAuthorization);

    if (executionPackage.programId !== PROGRAM_ID) {
      throw new Error(`unexpected execution package program id: ${executionPackage.programId}`);
    }

    if (executionPackage.functionId !== FUNCTION_ID) {
      throw new Error(`unexpected execution package function id: ${executionPackage.functionId}`);
    }

    if (executionRequest.submissionMode !== "relay") {
      throw new Error("direct participant submission is not allowed");
    }

    const requestedFeeMode = submission.feeMode ?? this.feeMode;
    if (requestedFeeMode !== "private-sponsored") {
      throw new Error("only private-sponsored fee mode is allowed");
    }

    assertExecutionRequestMatchesPackage(executionRequest, executionPackage);

    const relayAuthorization = assertRelayAuthorizationMatchesPackage(
      submission.relayAuthorization,
      executionPackage
    );

    const relayAuthorizationSignature =
      submission.relayAuthorizationSignature ?? submission.signature;

    if (relayAuthorizationSignature === undefined) {
      throw new Error("relay authorization signature is required");
    }

    const { signerAddress } = verifySignedRelayAuthorization({
      authorization: relayAuthorization,
      signature: relayAuthorizationSignature,
      signerAddress: submission.signerAddress
    });

    const deadline = normalizeField(relayAuthorization.deadline);
    if (deadline < BigInt(this.clock())) {
      throw new Error("relay authorization deadline has expired");
    }

    const nonceKey = this.nonceKey(signerAddress, relayAuthorization.nonce);
    if (this.usedNonces.has(nonceKey) || this.pendingNonces.has(nonceKey)) {
      throw new Error("relay authorization nonce already used");
    }

    if (await this.isNullifierUsedOnChain(relayAuthorization.nullifier)) {
      throw new Error("nullifier already used on-chain");
    }

    const transaction = this.assertTransaction(submission.transaction);

    return {
      executionPackage,
      executionRequest,
      relayAuthorization,
      relayAuthorizationSignature,
      signerAddress,
      nonceKey,
      transaction,
      feeMode: requestedFeeMode
    };
  }

  async submit(submission) {
    if (this.networkClient === null) {
      throw new Error("a network client is required for relay submission");
    }

    const validated = await this.validateSubmission(submission);

    if (validated.transaction === null) {
      throw new Error("transaction is required for relay submission");
    }

    this.pendingNonces.add(validated.nonceKey);

    try {
      const transactionId = await this.networkClient.submitTransaction(validated.transaction);
      let confirmation = null;

      if (this.waitForConfirmation) {
        confirmation = await this.networkClient.waitForTransactionConfirmation(
          transactionId,
          this.confirmationIntervalMs,
          this.confirmationTimeoutMs
        );
      }

      this.pendingNonces.delete(validated.nonceKey);
      this.usedNonces.add(validated.nonceKey);

      return {
        transactionId,
        confirmation,
        signerAddress: validated.signerAddress,
        feeMode: validated.feeMode,
        nullifier: validated.relayAuthorization.nullifier,
        nonce: validated.relayAuthorization.nonce
      };
    } catch (error) {
      this.pendingNonces.delete(validated.nonceKey);
      throw error;
    }
  }
}
