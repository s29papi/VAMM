import { pathToFileURL } from "node:url";

import { Account } from "@provablehq/sdk";

import {
  createContext,
  PROGRAM_ID,
  resolveProgramAddress,
  submitDelegatedProving,
  waitForConfirmation,
  stringifyJson
} from "./private-agent-swap-common.mjs";
import {
  buildBoundsHash,
  buildIntentHash,
  i64,
  signatureMessage,
  signIntent,
  u64,
  u128,
  verifyIntent
} from "./requester-intent-common.mjs";

function parsePayloadJson(raw) {
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("reverse prep payload must be a JSON object");
  }

  return parsed;
}

async function readStdinText() {
  if (process.stdin.isTTY) {
    return null;
  }

  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
  }

  return text.trim() || null;
}

async function loadReversePrepPayload() {
  const args = process.argv.slice(2);
  const payloadFileIndex = args.indexOf("--payload-file");
  if (payloadFileIndex >= 0) {
    const filePath = args[payloadFileIndex + 1];
    if (!filePath) {
      throw new Error("--payload-file requires a file path");
    }
    const { readFile } = await import("node:fs/promises");
    return parsePayloadJson(await readFile(filePath, "utf8"));
  }

  const payloadJsonIndex = args.indexOf("--payload-json");
  if (payloadJsonIndex >= 0) {
    const raw = args[payloadJsonIndex + 1];
    if (!raw) {
      throw new Error("--payload-json requires an inline JSON string");
    }
    return parsePayloadJson(raw);
  }

  const envPayload = process.env.ALEOVEIL_REVERSE_REQUESTER_PAYLOAD_JSON;
  if (envPayload) {
    return parsePayloadJson(envPayload);
  }

  const stdinText = await readStdinText();
  if (stdinText) {
    return parsePayloadJson(stdinText);
  }

  return null;
}

function pickField(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function requireField(payload, ...keys) {
  const value = pickField(payload, ...keys);
  if (value === null) {
    throw new Error(`missing reverse prep payload field: ${keys[0]}`);
  }
  return value;
}

function parseBigIntField(payload, ...keys) {
  const raw = requireField(payload, ...keys);
  try {
    return BigInt(String(raw));
  } catch {
    throw new Error(`invalid bigint payload field ${keys[0]}: ${String(raw)}`);
  }
}

function resolveExecutorAddress(payload) {
  const value = pickField(
    payload,
    "user_address",
    "executor_address",
    "counterparty",
    "counterparty_address",
  );
  return value ? String(value) : null;
}

async function executeReverseRequesterPrep(payload) {
  const requester = createContext("ALEOVEIL_TESTNET_PRIVATE_KEY");
  const requesterAddress = requester.account.address().to_string();
  const executorAddress = resolveExecutorAddress(payload);
  const recipientAddress = String(pickField(payload, "recipient") ?? requesterAddress);
  const orderId = payload.order_id !== undefined && payload.order_id !== null && payload.order_id !== ""
    ? BigInt(String(payload.order_id))
    : BigInt(Date.now());
  const approvalAmount = parseBigIntField(payload, "approval_amount", "amount_in", "sell_amount", "usdcx_amount");
  const expiryTimestamp = parseBigIntField(payload, "expiry_timestamp", "deadline", "expiry");
  const requesterMinPayout = parseBigIntField(payload, "min_payout", "min_output", "payout_min");
  const requesterMaxPayout = parseBigIntField(payload, "max_payout", "max_output", "payout_max");
  const boundsHash = await buildBoundsHash(requesterMinPayout, requesterMaxPayout);
  const intentHash = await buildIntentHash(
    orderId,
    approvalAmount,
    requesterAddress,
    expiryTimestamp,
    boundsHash,
    recipientAddress,
  );

  const ephemeral = new Account();
  const ephemeralSigner = ephemeral.address().to_string();
  const signature = signIntent(ephemeral.privateKey(), intentHash);
  if (!verifyIntent(ephemeralSigner, signature, intentHash)) {
    throw new Error("reverse prep ephemeral signature failed local verification");
  }

  const settlementProgramAddress = await resolveProgramAddress();
  const latestBlock = await requester.networkClient.getLatestBlock();
  const latestTimestamp = Number(latestBlock?.header?.metadata?.timestamp);
  if (!Number.isFinite(latestTimestamp)) {
    throw new Error("could not read latest Aleo block timestamp");
  }
  if (BigInt(latestTimestamp) > expiryTimestamp) {
    throw new Error("reverse prep payload has already expired");
  }

  const approval = await submitDelegatedProving(requester, {
    programName: "test_usdcx_stablecoin.aleo",
    functionName: "approve_public",
    inputs: [settlementProgramAddress, u128(approvalAmount)]
  });
  const approvalTxId = approval.result.transaction.id;
  await waitForConfirmation(requester.networkClient, approvalTxId);

  const authorization = await submitDelegatedProving(requester, {
    programName: PROGRAM_ID,
    functionName: "authorize_order",
    inputs: [
      u64(orderId),
      ephemeralSigner,
      recipientAddress
    ]
  });
  const authorizationTxId = authorization.result.transaction.id;
  await waitForConfirmation(requester.networkClient, authorizationTxId);

  const payloadOut = {
    order_id: orderId.toString(),
    approval_amount: approvalAmount.toString(),
    requester: requesterAddress,
    recipient: recipientAddress,
    executor_address: executorAddress,
    ephemeral_signer: ephemeralSigner,
    expiry_timestamp: expiryTimestamp.toString(),
    min_payout: requesterMinPayout.toString(),
    max_payout: requesterMaxPayout.toString(),
    bounds_hash: boundsHash,
    intent_hash: intentHash,
    signature,
    authorize_tx_id: authorizationTxId,
    authorize_wallet_tx_id: authorizationTxId,
    approval_tx_id: approvalTxId,
    approval_wallet_tx_id: approvalTxId,
  };

  return {
    mode: "reverse_requester_prep",
    program: PROGRAM_ID,
    settlementProgramAddress,
    requester: requesterAddress,
    recipient: recipientAddress,
    executorAddress,
    orderId: orderId.toString(),
    approvalAmountMicrocredits: approvalAmount.toString(),
    minPayoutMicrocredits: requesterMinPayout.toString(),
    maxPayoutMicrocredits: requesterMaxPayout.toString(),
    expiryTimestamp: expiryTimestamp.toString(),
    boundsHash,
    intentHash,
    signatureMessage: signatureMessage(intentHash),
    ephemeralSigner,
    approvalTxId,
    authorizationTxId,
    requesterApprovalTx: approvalTxId,
    requesterAuthorizationTx: authorizationTxId,
    approvalWalletTxId: approvalTxId,
    authorizationWalletTxId: authorizationTxId,
    payload: payloadOut,
    payloadJson: stringifyJson(payloadOut),
  };
}

export async function prepareVammReverseRequesterOrder() {
  const payload = await loadReversePrepPayload();
  if (!payload) {
    throw new Error("missing reverse prep payload");
  }

  return executeReverseRequesterPrep(payload);
}

async function main() {
  const result = await prepareVammReverseRequesterOrder();
  process.stdout.write(stringifyJson(result));
  process.stdout.write("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
