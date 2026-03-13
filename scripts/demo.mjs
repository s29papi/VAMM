import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import {
  AleoNetworkClient,
  Account,
  ProgramManager,
  getOrInitConsensusVersionTestHeights
} from "@provablehq/sdk";

import { DEVNET_PRIVATE_KEY, PROGRAM_ID } from "../src/constants.mjs";
import { createGroupState } from "../src/group-state.mjs";
import { createIdentity } from "../src/identity.mjs";
import { buildLocalRelaySubmission, submitLocalRelaySubmission } from "../src/relay-submission.mjs";

const NETWORK_HOST = process.env.ALEOVEIL_NETWORK_HOST ?? "http://127.0.0.1:3030";
const RELAYER_URL = process.env.ALEOVEIL_RELAYER_URL ?? "http://127.0.0.1:4040";
const RELAYER_PORT = Number(new URL(RELAYER_URL).port || "4040");
const RELAYER_HOST = process.env.ALEOVEIL_RELAYER_BIND ?? "127.0.0.1";
const DEMO_MESSAGE = "vote:yes";

function logStep(step, message) {
  process.stdout.write(`[${step}] ${message}\n`);
}

function createAdminContext() {
  const account = new Account({ privateKey: DEVNET_PRIVATE_KEY });
  const programManager = new ProgramManager(NETWORK_HOST);
  programManager.setAccount(account);

  return {
    account,
    networkClient: new AleoNetworkClient(NETWORK_HOST),
    programManager
  };
}

async function waitForRelayer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${RELAYER_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(200);
  }

  throw new Error(`relayer did not become healthy at ${RELAYER_URL}`);
}

async function startRelayer() {
  const child = spawn("node", ["src/relayer-server.mjs"], {
    cwd: "/home/usih/go/src/github.com/searchbox-labs/aleoveil",
    env: {
      ...process.env,
      ALEOVEIL_NETWORK_HOST: NETWORK_HOST,
      ALEOVEIL_RELAYER_BIND: RELAYER_HOST,
      ALEOVEIL_RELAYER_PORT: String(RELAYER_PORT),
      ALEOVEIL_RELAYER_WAIT_FOR_CONFIRMATION: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  await waitForRelayer();
  return child;
}

async function ensureProgramExists(networkClient) {
  try {
    await networkClient.getProgram(PROGRAM_ID);
  } catch (error) {
    throw new Error(
      `${PROGRAM_ID} is not deployed on ${NETWORK_HOST}. Deploy the program before running the demo.`
    );
  }
}

async function getInitialized(networkClient) {
  try {
    const value = await networkClient.getProgramMappingValue(PROGRAM_ID, "initialized", "0u8");
    return /^true\b/i.test(String(value ?? "").trim());
  } catch {
    return false;
  }
}

async function submitDirectDevnode(programManager, networkClient, functionName, inputs) {
  const tx = await programManager.buildDevnodeExecutionTransaction({
    programName: PROGRAM_ID,
    functionName,
    priorityFee: 0,
    privateFee: false,
    inputs
  });

  const transactionId = await networkClient.submitTransaction(tx.toString());
  await networkClient.waitForTransactionConfirmation(transactionId, 500, 20_000);
  return transactionId;
}

async function ensureInitialized(context) {
  if (await getInitialized(context.networkClient)) {
    return null;
  }

  return submitDirectDevnode(context.programManager, context.networkClient, "initialize", [
    `${context.account.address().to_string()}`
  ]);
}

async function createOnChainGroup(context, groupId) {
  return submitDirectDevnode(context.programManager, context.networkClient, "create_group", [
    `${groupId}u64`,
    `${context.account.address().to_string()}`
  ]);
}

async function addOnChainMember(context, groupId, group, commitment) {
  const appendWitness = group.generateAppendWitness();

  return submitDirectDevnode(context.programManager, context.networkClient, "add_member", [
    `${groupId}u64`,
    `${commitment}field`,
    `${appendWitness.merkleRoot}field`,
    `${appendWitness.merkleProofLength}u8`,
    `${appendWitness.merkleProofIndex}u32`,
    `[${appendWitness.merkleProofSiblings.map((value) => `${value}field`).join(", ")}]`
  ]);
}

async function assertNullifierUsed(networkClient, nullifier) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

    await delay(500);
  }

  throw new Error("validate_proof_depth_20 did not mark the nullifier as used");
}

async function main() {
  getOrInitConsensusVersionTestHeights("0,1,2,3,4,5,6,7,8,9,10,11,12");

  const context = createAdminContext();
  await ensureProgramExists(context.networkClient);

  const relayer = await startRelayer();
  const stopRelayer = () => {
    if (!relayer.killed) {
      relayer.kill("SIGTERM");
    }
  };

  process.on("exit", stopRelayer);
  process.on("SIGINT", () => {
    stopRelayer();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    stopRelayer();
    process.exit(1);
  });

  try {
    const initializedTx = await ensureInitialized(context);
    if (initializedTx) {
      process.stdout.write(`Initialized program with tx ${initializedTx}\n`);
    }

    const groupId = BigInt(Date.now());
    const scope = `demo:${groupId}`;

    logStep(1, "Generating identity");
    const identity = createIdentity();
    process.stdout.write(`identity commitment: ${identity.commitment}\n`);

    logStep(2, "Creating group");
    await createOnChainGroup(context, groupId);
    const group = createGroupState([]);
    process.stdout.write(`group id: ${groupId}\n`);

    logStep(3, "Adding member");
    await addOnChainMember(context, groupId, group, identity.commitment);
    group.addMember(identity.commitment);
    process.stdout.write(`group root: ${group.root}\n`);

    logStep(4, "Building local Aleo proof transaction");
    const submission = await buildLocalRelaySubmission({
      groupId,
      identity,
      group,
      message: DEMO_MESSAGE,
      scope,
      relayDeadline: BigInt(Math.floor(Date.now() / 1_000) + 600),
      relayNonce: groupId,
      provingPrivateKey: DEVNET_PRIVATE_KEY,
      networkHost: NETWORK_HOST,
      feeMode: "private-sponsored",
      devnode: true
    });
    process.stdout.write(`nullifier: ${submission.executionPackage.nullifier}\n`);

    logStep(5, "Sending relay submission");
    const result = await submitLocalRelaySubmission(RELAYER_URL, submission);
    process.stdout.write(`transaction id: ${result.transactionId}\n`);

    await assertNullifierUsed(context.networkClient, submission.executionPackage.nullifier);

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
