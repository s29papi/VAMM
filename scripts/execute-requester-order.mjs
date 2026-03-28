import { readFile } from "node:fs/promises";
import { Account } from "@provablehq/sdk";
import { pathToFileURL } from "node:url";

import {
  createContext,
  decryptOwnedRecordsFromTransaction,
  PROGRAM_ID,
  resolveProgramAddress,
  submitDelegatedProving,
  waitForConfirmation
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

const CG_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=aleo&vs_currencies=usd";

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid numeric env var ${name}`);
  }

  return value;
}

async function fetchAleoUsdPrice() {
  const override = process.env.ALEOVEIL_ALEO_USD_PRICE;
  if (override !== undefined && override !== "") {
    const value = Number(override);
    if (!Number.isFinite(value)) {
      throw new Error("ALEOVEIL_ALEO_USD_PRICE must be numeric");
    }
    return value;
  }

  const response = await fetch(CG_PRICE_URL, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ALEO price: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const value = json?.aleo?.usd;
  if (typeof value !== "number") {
    throw new Error("unexpected price response from CoinGecko");
  }

  return value;
}

function extractAmountFromLiteral(value) {
  return BigInt(String(value).replace(/[^0-9].*$/, ""));
}

function tryParsePrivateKeyEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  return new Account({ privateKey: raw });
}

function createEphemeralAccount() {
  return tryParsePrivateKeyEnv("ALEOVEIL_EPHEMERAL_PRIVATE_KEY") ?? new Account();
}

function resolveMakerPrivateKeyEnvVar() {
  return process.env.ALEOVEIL_USE_REQUESTER_AS_MAKER === "true"
    ? "ALEOVEIL_REQUESTER_PRIVATE_KEY"
    : "ALEOVEIL_TESTNET_PRIVATE_KEY";
}

async function ensureTransactionExists(networkClient, transactionId, label) {
  try {
    await networkClient.getTransaction(transactionId);
  } catch (error) {
    throw new Error(`${label} transaction not found: ${transactionId} (${String(error?.message ?? error)})`);
  }
}

function parsePayloadJson(raw) {
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("requester payload must be a JSON object");
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

async function loadRequesterPayload() {
  const args = process.argv.slice(2);
  const payloadFileIndex = args.indexOf("--payload-file");
  if (payloadFileIndex >= 0) {
    const filePath = args[payloadFileIndex + 1];
    if (!filePath) {
      throw new Error("--payload-file requires a file path");
    }
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

  const envPayload = process.env.ALEOVEIL_REQUESTER_PAYLOAD_JSON;
  if (envPayload) {
    return parsePayloadJson(envPayload);
  }

  const stdinText = await readStdinText();
  if (stdinText) {
    return parsePayloadJson(stdinText);
  }

  return null;
}

function assertPayloadField(payload, key) {
  const value = payload?.[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`missing delegated requester payload field: ${key}`);
  }
  return value;
}

function parseBigIntField(payload, key) {
  const raw = assertPayloadField(payload, key);
  try {
    return BigInt(String(raw));
  } catch {
    throw new Error(`invalid bigint payload field ${key}: ${String(raw)}`);
  }
}

function midpointBigInt(minValue, maxValue) {
  if (maxValue < minValue) {
    throw new Error("payload max_payout cannot be less than min_payout");
  }

  return minValue + ((maxValue - minValue) / 2n);
}

async function executeDelegatedRequesterOrder(payload) {
  const maker = createContext(resolveMakerPrivateKeyEnvVar());
  const requesterAddress = String(assertPayloadField(payload, "requester"));
  const recipientAddress = String(payload.recipient ?? requesterAddress);
  const ephemeralSignerAddress = String(assertPayloadField(payload, "ephemeral_signer"));
  const orderId = parseBigIntField(payload, "order_id");
  const approvalAmount = parseBigIntField(payload, "approval_amount");
  const expiryTimestamp = parseBigIntField(payload, "expiry_timestamp");
  const requesterMinPayout = parseBigIntField(payload, "min_payout");
  const requesterMaxPayout = parseBigIntField(payload, "max_payout");
  const boundsHash = String(assertPayloadField(payload, "bounds_hash"));
  const intentHash = String(assertPayloadField(payload, "intent_hash"));
  const signature = String(assertPayloadField(payload, "signature"));
  const authorizationTxId = String(assertPayloadField(payload, "authorize_tx_id"));
  const approvalTxId = String(assertPayloadField(payload, "approval_tx_id"));
  const makerPayoutMicrocredits = process.env.ALEOVEIL_MAKER_PAYOUT_MICROCREDITS
    ? BigInt(process.env.ALEOVEIL_MAKER_PAYOUT_MICROCREDITS)
    : midpointBigInt(requesterMinPayout, requesterMaxPayout);

  const latestBlock = await maker.networkClient.getLatestBlock();
  const latestTimestamp = Number(latestBlock?.header?.metadata?.timestamp);
  if (!Number.isFinite(latestTimestamp)) {
    throw new Error("could not read latest Aleo block timestamp");
  }
  if (BigInt(latestTimestamp) > expiryTimestamp) {
    throw new Error("requester payload has already expired");
  }

  const expectedBoundsHash = buildBoundsHash(requesterMinPayout, requesterMaxPayout);
  if (expectedBoundsHash !== boundsHash) {
    throw new Error("payload bounds hash does not match the provided payout range");
  }

  const expectedIntentHash = buildIntentHash(
    orderId,
    approvalAmount,
    requesterAddress,
    expiryTimestamp,
    boundsHash,
    recipientAddress
  );
  if (expectedIntentHash !== intentHash) {
    throw new Error("payload intent hash does not match the provided payload fields");
  }

  if (!verifyIntent(ephemeralSignerAddress, signature, intentHash)) {
    throw new Error("delegated ephemeral signature failed verification");
  }

  await ensureTransactionExists(maker.networkClient, authorizationTxId, "authorization");
  await ensureTransactionExists(maker.networkClient, approvalTxId, "approval");

  const makerFunding = await submitDelegatedProving(maker, {
    programName: "credits.aleo",
    functionName: "transfer_public_to_private",
    inputs: [maker.account.address().to_string(), u64(Number(makerPayoutMicrocredits))]
  });
  const makerFundingTxId = makerFunding.result.transaction.id;
  await waitForConfirmation(maker.networkClient, makerFundingTxId);
  const makerPrivateRecords = await decryptOwnedRecordsFromTransaction(
    maker.networkClient,
    makerFundingTxId,
    maker.account
  );
  const makerCreditsRecord = makerPrivateRecords[0];
  if (!makerCreditsRecord) {
    throw new Error("could not decrypt maker private credits record");
  }

  const settlementInputs = [
    u64(orderId),
    u128(approvalAmount),
    makerCreditsRecord,
    requesterAddress,
    maker.account.address().to_string(),
    recipientAddress,
    recipientAddress,
    u64(Number(requesterMinPayout)),
    u64(Number(requesterMaxPayout)),
    i64(Number(expiryTimestamp)),
    boundsHash,
    ephemeralSignerAddress,
    signature
  ];

  const settlement = await submitDelegatedProving(maker, {
    programName: PROGRAM_ID,
    functionName: "settle_order",
    inputs: settlementInputs
  });
  const settlementTxId = settlement.result.transaction.id;
  await waitForConfirmation(maker.networkClient, settlementTxId);

  let replayError = null;
  let replaySucceeded = false;
  try {
    const replay = await submitDelegatedProving(maker, {
      programName: PROGRAM_ID,
      functionName: "settle_order",
      inputs: settlementInputs
    });
    const replayTxId = replay.result.transaction.id;
    await waitForConfirmation(maker.networkClient, replayTxId);
    replaySucceeded = true;
  } catch (error) {
    replayError = String(error?.message ?? error);
  }

  if (replaySucceeded) {
    throw new Error("replay guard failed: the same delegated authorization settled twice");
  }

  const makerSettlementRecords = await decryptOwnedRecordsFromTransaction(
    maker.networkClient,
    settlementTxId,
    maker.account
  );

  return {
    program: PROGRAM_ID,
    settlementProgramAddress: await resolveProgramAddress(),
    requester: requesterAddress,
    recipient: recipientAddress,
    ephemeralSigner: ephemeralSignerAddress,
    orderId: orderId.toString(),
    approvalAmountMicrocredits: approvalAmount.toString(),
    minPayoutMicrocredits: requesterMinPayout.toString(),
    maxPayoutMicrocredits: requesterMaxPayout.toString(),
    expiryTimestamp: expiryTimestamp.toString(),
    boundsHash,
    intentHash,
    signatureMessage: signatureMessage(intentHash),
    requesterApprovalTx: approvalTxId,
    requesterAuthorizationTx: authorizationTxId,
    makerFundingTx: makerFundingTxId,
    settlementTx: settlementTxId,
    replayError,
    makerFundingRecords: makerPrivateRecords,
    makerSettlementRecords,
    aleoUsdPrice: null,
    targetAleo: null,
    bufferBps: null
  };
}

async function executeLegacyRequesterOrder() {
  const orderId = readNumber("ALEOVEIL_ORDER_ID", 1);
  const targetAleo = readNumber("ALEOVEIL_TARGET_ALEO", 0.02);
  const bufferBps = readNumber("ALEOVEIL_BUFFER_BPS", 500);
  const deadlineSeconds = readNumber("ALEOVEIL_DEADLINE_SECONDS", readNumber("ALEOVEIL_DEADLINE_WINDOW", 300));
  const maker = createContext(resolveMakerPrivateKeyEnvVar());
  const requester = createContext("ALEOVEIL_REQUESTER_PRIVATE_KEY");
  const ephemeral = createEphemeralAccount();
  const recipientAddress = process.env.ALEOVEIL_RECIPIENT_ADDRESS ?? requester.account.address().to_string();

  const aleoUsdPrice = await fetchAleoUsdPrice();
  const latestBlock = await maker.networkClient.getLatestBlock();
  const latestTimestamp = Number(latestBlock.header.metadata.timestamp);
  if (!Number.isFinite(latestTimestamp)) {
    throw new Error("could not read latest Aleo block timestamp");
  }

  const estimatedUsdcx = targetAleo * aleoUsdPrice;
  const approvalUsdcx = BigInt(Math.ceil(estimatedUsdcx * (1 + bufferBps / 10_000) * 1_000_000));
  const makerPayoutMicrocredits = BigInt(Math.round(targetAleo * 1_000_000));
  const requesterMinPayout = BigInt(readNumber("ALEOVEIL_REQUESTER_MIN_PAYOUT", Number(makerPayoutMicrocredits)));
  const requesterMaxPayout = BigInt(readNumber("ALEOVEIL_REQUESTER_MAX_PAYOUT", Number(makerPayoutMicrocredits)));
  const expiryTimestamp = latestTimestamp + deadlineSeconds;
  const requesterBoundsHash = buildBoundsHash(requesterMinPayout, requesterMaxPayout);
  const requesterIntentHash = buildIntentHash(
    orderId,
    approvalUsdcx,
    requester.account.address().to_string(),
    expiryTimestamp,
    requesterBoundsHash,
    recipientAddress
  );
  const delegatedSignature = signIntent(ephemeral.privateKey(), requesterIntentHash);
  const settlementProgramAddress = await resolveProgramAddress();

  const approval = await submitDelegatedProving(requester, {
    programName: "test_usdcx_stablecoin.aleo",
    functionName: "approve_public",
    inputs: [settlementProgramAddress, u128(approvalUsdcx)]
  });
  const approvalTxId = approval.result.transaction.id;
  await waitForConfirmation(requester.networkClient, approvalTxId);

  const authorization = await submitDelegatedProving(requester, {
    programName: PROGRAM_ID,
    functionName: "authorize_order",
    inputs: [
      u64(orderId),
      ephemeral.address().to_string(),
      recipientAddress
    ]
  });
  const authorizationTxId = authorization.result.transaction.id;
  await waitForConfirmation(requester.networkClient, authorizationTxId);

  const makerFunding = await submitDelegatedProving(maker, {
    programName: "credits.aleo",
    functionName: "transfer_public_to_private",
    inputs: [maker.account.address().to_string(), u64(Number(makerPayoutMicrocredits))]
  });
  const makerFundingTxId = makerFunding.result.transaction.id;
  await waitForConfirmation(maker.networkClient, makerFundingTxId);
  const makerPrivateRecords = await decryptOwnedRecordsFromTransaction(
    maker.networkClient,
    makerFundingTxId,
    maker.account
  );
  const makerCreditsRecord = makerPrivateRecords[0];
  if (!makerCreditsRecord) {
    throw new Error("could not decrypt maker private credits record");
  }

  const settlementInputs = [
    u64(orderId),
    u128(approvalUsdcx),
    makerCreditsRecord,
    requester.account.address().to_string(),
    maker.account.address().to_string(),
    recipientAddress,
    recipientAddress,
    u64(Number(requesterMinPayout)),
    u64(Number(requesterMaxPayout)),
    i64(expiryTimestamp),
    requesterBoundsHash,
    ephemeral.address().to_string(),
    delegatedSignature
  ];

  const settlement = await submitDelegatedProving(maker, {
    programName: PROGRAM_ID,
    functionName: "settle_order",
    inputs: settlementInputs
  });
  const settlementTxId = settlement.result.transaction.id;
  await waitForConfirmation(maker.networkClient, settlementTxId);

  let replayError = null;
  try {
    const replay = await submitDelegatedProving(maker, {
      programName: PROGRAM_ID,
      functionName: "settle_order",
      inputs: settlementInputs
    });
    const replayTxId = replay.result.transaction.id;
    await waitForConfirmation(maker.networkClient, replayTxId);
  } catch (error) {
    replayError = String(error?.message ?? error);
  }

  const makerSettlementRecords = await decryptOwnedRecordsFromTransaction(
    maker.networkClient,
    settlementTxId,
    maker.account
  );
  const requesterSettlementRecords = await decryptOwnedRecordsFromTransaction(
    requester.networkClient,
    settlementTxId,
    requester.account
  );

  if (!verifyIntent(ephemeral.address().to_string(), delegatedSignature, requesterIntentHash)) {
    throw new Error("delegated signature failed local verification");
  }

  return {
    program: PROGRAM_ID,
    settlementProgramAddress,
    requester: requester.account.address().to_string(),
    recipient: recipientAddress,
    ephemeralSigner: ephemeral.address().to_string(),
    orderId,
    approvalAmountMicrocredits: approvalUsdcx.toString(),
    minPayoutMicrocredits: requesterMinPayout.toString(),
    maxPayoutMicrocredits: requesterMaxPayout.toString(),
    expiryTimestamp,
    boundsHash: requesterBoundsHash,
    intentHash: requesterIntentHash,
    signatureMessage: signatureMessage(requesterIntentHash),
    requesterApprovalTx: approvalTxId,
    requesterAuthorizationTx: authorizationTxId,
    makerFundingTx: makerFundingTxId,
    settlementTx: settlementTxId,
    replayError,
    makerFundingRecords: makerPrivateRecords,
    makerSettlementRecords,
    requesterSettlementRecords,
    aleoUsdPrice,
    targetAleo,
    bufferBps
  };
}

export async function executeRequesterOrder() {
  const payload = await loadRequesterPayload();
  if (payload) {
    return executeDelegatedRequesterOrder(payload);
  }

  return executeLegacyRequesterOrder();
}

async function main() {
  const result = await executeRequesterOrder();
  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
