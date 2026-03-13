import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { Account } from "@provablehq/sdk";

import { PROGRAM_ID } from "../src/constants.mjs";
import { createGroupState } from "../src/group-state.mjs";
import { createIdentity } from "../src/identity.mjs";
import { buildLocalRelaySubmission, submitLocalRelaySubmission } from "../src/relay-submission.mjs";
import { getTestnetConfig, createNetworkClient, createProgramManager, isProgramDeployed } from "./testnet-common.mjs";

function logStep(step, message) {
  process.stdout.write(`[${step}] ${message}\n`);
}

async function waitForRelayer(relayerUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${relayerUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(200);
  }

  throw new Error(`relayer did not become healthy at ${relayerUrl}`);
}

async function startRelayer(config) {
  const child = spawn("node", ["src/relayer-server.mjs"], {
    cwd: "/home/usih/go/src/github.com/searchbox-labs/aleoveil",
    env: {
      ...process.env,
      ALEOVEIL_NETWORK_HOST: config.endpoint,
      ALEOVEIL_RELAYER_BIND: config.relayerBind,
      ALEOVEIL_RELAYER_PORT: String(config.relayerPort),
      ALEOVEIL_RELAYER_WAIT_FOR_CONFIRMATION: "false"
    },
    stdio: ["ignore", "ignore", "inherit"]
  });

  await waitForRelayer(config.relayerUrl);
  return child;
}

async function getInitialized(networkClient) {
  try {
    const value = await networkClient.getProgramMappingValue(PROGRAM_ID, "initialized", "0u8");
    return /^true\b/i.test(String(value ?? "").trim());
  } catch {
    return false;
  }
}

async function confirmTransaction(networkClient, transactionId) {
  return networkClient.waitForTransactionConfirmation(transactionId, 2_000, 120_000);
}

async function executeAndConfirm(programManager, networkClient, functionName, inputs) {
  const transactionId = await programManager.execute({
    programName: PROGRAM_ID,
    functionName,
    priorityFee: 0,
    privateFee: false,
    inputs
  });

  await confirmTransaction(networkClient, transactionId);
  return transactionId;
}

async function ensureInitialized(context) {
  if (await getInitialized(context.networkClient)) {
    return null;
  }

  return executeAndConfirm(context.programManager, context.networkClient, "initialize", [
    context.account.address().to_string()
  ]);
}

async function assertNullifierUsed(networkClient, nullifier) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const value = await networkClient.getProgramMappingValue(
        PROGRAM_ID,
        "nullifier_used",
        `${nullifier}field`
      );

      if (/^true\b/i.test(String(value ?? "").trim())) {
        return;
      }
    } catch {}

    await delay(2_000);
  }

  throw new Error("validate_proof_depth_20 did not mark the nullifier as used on testnet");
}

async function main() {
  const config = getTestnetConfig();
  if (!(await isProgramDeployed(config.endpoint))) {
    throw new Error(`${PROGRAM_ID} is not deployed on testnet. Run ./testnet-deploy.sh first.`);
  }

  const account = new Account({ privateKey: config.adminPrivateKey });
  const networkClient = createNetworkClient(config.endpoint);
  const programManager = createProgramManager(config.endpoint, config.adminPrivateKey);
  const relayer = await startRelayer(config);

  const stopRelayer = () => {
    if (!relayer.killed) {
      relayer.kill("SIGTERM");
    }
  };

  process.on("exit", stopRelayer);

  try {
    const initTx = await ensureInitialized({ account, networkClient, programManager });
    if (initTx) {
      process.stdout.write(`initialize tx: ${initTx}\n`);
    }

    const groupId = BigInt(Date.now());
    const scope = `tn:${groupId}`;

    logStep(1, "Generating identity");
    const identity = createIdentity();
    process.stdout.write(`identity commitment: ${identity.commitment}\n`);

    logStep(2, "Creating group");
    const createGroupTx = await executeAndConfirm(
      programManager,
      networkClient,
      "create_group",
      [`${groupId}u64`, account.address().to_string()]
    );
    const group = createGroupState([]);
    process.stdout.write(`create_group tx: ${createGroupTx}\n`);

    logStep(3, "Adding member");
    const appendWitness = group.generateAppendWitness();
    const addMemberTx = await executeAndConfirm(
      programManager,
      networkClient,
      "add_member",
      [
        `${groupId}u64`,
        `${identity.commitment}field`,
        `${appendWitness.merkleRoot}field`,
        `${appendWitness.merkleProofLength}u8`,
        `${appendWitness.merkleProofIndex}u32`,
        `[${appendWitness.merkleProofSiblings.map((value) => `${value}field`).join(", ")}]`
      ]
    );
    group.addMember(identity.commitment);
    process.stdout.write(`add_member tx: ${addMemberTx}\n`);

    logStep(4, "Building local Aleo proof transaction");
    const submission = await buildLocalRelaySubmission({
      groupId,
      identity,
      group,
      message: "vote:yes",
      scope,
      relayTtlSeconds: 7_200,
      relayNonce: groupId,
      provingPrivateKey: config.userPrivateKey,
      networkHost: config.endpoint,
      feeMode: "private-sponsored"
    });
    process.stdout.write(`nullifier: ${submission.executionPackage.nullifier}\n`);

    logStep(5, "Sending relay submission");
    const result = await submitLocalRelaySubmission(config.relayerUrl, submission);
    process.stdout.write(`transaction id: ${result.transactionId}\n`);

    await confirmTransaction(networkClient, result.transactionId);
    await assertNullifierUsed(networkClient, submission.executionPackage.nullifier);

    logStep(6, "validate_proof_depth_20 success");
  } finally {
    stopRelayer();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
