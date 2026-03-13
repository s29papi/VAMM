import { Account, ProgramManager } from "@provablehq/sdk";

import { buildExecutionPackage } from "./execution-package.mjs";
import { buildExecutionRequest } from "./execution-request.mjs";
import { buildRelayAuthorization, signRelayAuthorization } from "./relayer-authorization.mjs";
import { buildAleoWitness } from "./witness-builder.mjs";

function createProgramManager({ networkHost, privateKey, programManager }) {
  if (programManager) {
    return programManager;
  }

  if (networkHost === undefined) {
    throw new Error("networkHost is required when no programManager is provided");
  }

  const manager = new ProgramManager(networkHost);
  manager.setAccount(new Account({ privateKey }));
  return manager;
}

function witnessToExecutionInputs(witness) {
  return [
    `${witness.groupId}u64`,
    `${witness.merkleRoot}field`,
    `${witness.nullifier}field`,
    `[${witness.message.map((value) => `${value}field`).join(", ")}]`,
    `${witness.scopeHash}field`,
    `${witness.identitySecret}field`,
    `${witness.merkleProofLength}u8`,
    `${witness.merkleProofIndex}u32`,
    `[${witness.merkleProofSiblings.map((value) => `${value}field`).join(", ")}]`
  ];
}

export async function buildLocalRelaySubmission({
  groupId,
  identity,
  group,
  message,
  scope,
  relayDeadline,
  relayTtlSeconds = 900,
  relayNonce,
  provingPrivateKey,
  networkHost,
  priorityFee = 0,
  privateFee = false,
  feeMode,
  devnode = false,
  programManager
}) {
  const witness = buildAleoWitness({
    groupId,
    identity,
    group,
    message,
    scope
  });

  const executionPackage = buildExecutionPackage({
    groupId: witness.groupId,
    merkleRoot: witness.merkleRoot,
    nullifier: witness.nullifier,
    message: witness.message,
    scopeHash: witness.scopeHash
  });

  const executionRequest = buildExecutionRequest(executionPackage);

  const manager = createProgramManager({
    networkHost,
    privateKey: provingPrivateKey,
    programManager
  });

  const txBuilder = devnode
    ? manager.buildDevnodeExecutionTransaction.bind(manager)
    : manager.buildExecutionTransaction.bind(manager);

  const transaction = await txBuilder({
    programName: executionPackage.programId,
    functionName: executionPackage.functionId,
    priorityFee,
    privateFee,
    inputs: witnessToExecutionInputs(witness)
  });

  const effectiveRelayDeadline = relayDeadline
    ?? BigInt(Math.floor(Date.now() / 1_000) + relayTtlSeconds);

  const relayAuthorization = buildRelayAuthorization({
    groupId: executionPackage.groupId,
    merkleRoot: executionPackage.merkleRoot,
    nullifier: executionPackage.nullifier,
    message: executionPackage.message,
    scopeHash: executionPackage.scopeHash,
    deadline: effectiveRelayDeadline,
    nonce: relayNonce
  });
  const relayAuthorizationSignature = signRelayAuthorization(
    provingPrivateKey,
    relayAuthorization
  );

  return {
    executionPackage,
    executionRequest,
    relayAuthorization,
    relayAuthorizationSignature: relayAuthorizationSignature.signature,
    signerAddress: relayAuthorizationSignature.signerAddress,
    transaction: typeof transaction.toString === "function" ? transaction.toString() : transaction,
    feeMode: feeMode ?? (privateFee ? "private-sponsored" : "public-sponsored")
  };
}

export async function submitLocalRelaySubmission(relayerUrl, submission, fetchImpl = fetch) {
  const response = await fetchImpl(`${relayerUrl.replace(/\/$/, "")}/relay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submission)
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? `relay request failed with status ${response.status}`);
  }

  return payload.result;
}
