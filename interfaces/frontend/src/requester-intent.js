const TESTNET_ENDPOINT = import.meta.env.VITE_ALEOVEIL_TESTNET_ENDPOINT ?? "https://api.provable.com/v2";

const DEFAULT_SETTLEMENT_PROGRAM_ID = "vammsettlementv10.aleo";
const DEFAULT_SETTLEMENT_PROGRAM_ADDRESS = "aleo10cg7xzs7z8pegkskuy3dd89a5fxq0rm854zfpsvehp9rgnpuhuysjzwff0";

export const ACTIVE_PROGRAM_ID =
  import.meta.env.VITE_VAMM_SETTLEMENT_PROGRAM_ID ?? DEFAULT_SETTLEMENT_PROGRAM_ID;
export const ACTIVE_PROGRAM_ADDRESS =
  import.meta.env.VITE_VAMM_SETTLEMENT_PROGRAM_ADDRESS ?? DEFAULT_SETTLEMENT_PROGRAM_ADDRESS;

let sdkPromise;
let networkClientPromise;
const INDEXING_POLL_INTERVAL_MS = 2_000;
const INDEXING_TIMEOUT_MS = 180_000;
const INDEXING_LAG_NOTICE_MS = 8_000;

async function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@provablehq/sdk/testnet.js");
  }
  return sdkPromise;
}

async function getNetworkClient() {
  if (!networkClientPromise) {
    networkClientPromise = loadSdk().then(({ AleoNetworkClient }) => new AleoNetworkClient(TESTNET_ENDPOINT));
  }
  return networkClientPromise;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isTransactionLookupMiss(error) {
  return /404|not found|could not get url|transaction/i.test(String(error?.message ?? error));
}

export function u64(value) {
  return `${value}u64`;
}

export function u128(value) {
  return `${value}u128`;
}

export function i64(value) {
  return `${value}i64`;
}

export function field(value) {
  return typeof value === "string" && value.endsWith("field") ? value : `${value}field`;
}

export function toMicroAmount(amount, decimals = 6) {
  return BigInt(Math.ceil(Number(amount) * 10 ** decimals));
}

export async function buildBoundsHash(minPayout, maxPayout) {
  const { Plaintext, Poseidon2 } = await loadSdk();
  const plaintext = Plaintext.fromString(
    `{ min_payout: ${u64(Number(minPayout))}, max_payout: ${u64(Number(maxPayout))} }`,
  );
  return new Poseidon2().hash(plaintext.toFieldsRaw(), "field").toString();
}

export async function buildIntentHash(
  orderId,
  approvalAmount,
  requesterAddress,
  expiryTimestamp,
  boundsHash,
  recipientAddress = requesterAddress,
) {
  const { Plaintext, Poseidon2 } = await loadSdk();
  const plaintext = Plaintext.fromString(
    `{ order_id: ${u64(Number(orderId))}, approval_amount: ${u128(approvalAmount)}, requester: ${requesterAddress}, recipient: ${recipientAddress}, expiry_timestamp: ${i64(Number(expiryTimestamp))}, bounds_hash: ${field(boundsHash)} }`,
  );
  return new Poseidon2().hash(plaintext.toFieldsRaw(), "field").toString();
}

export function signatureMessage(intentHash) {
  return `[${field(intentHash)}]`;
}

export async function createEphemeralSigner() {
  const { PrivateKey } = await loadSdk();
  const privateKey = new PrivateKey();

  return {
    privateKey,
    address: privateKey.to_address().to_string(),
  };
}

export function signRequesterIntent(privateKey, intentHash) {
  return privateKey.signValue(signatureMessage(intentHash)).to_string();
}

export function buildAuthorizeOrderInputs(orderId, ephemeralSignerAddress, recipientAddress) {
  return [u64(Number(orderId)), ephemeralSignerAddress, recipientAddress];
}

export function decodeSignatureBytes(signatureBytes) {
  return new TextDecoder().decode(signatureBytes).trim();
}

export async function verifyRequesterIntent(requesterAddress, signatureString, intentHash) {
  const { Address, Signature } = await loadSdk();
  const address = Address.from_string(requesterAddress);
  const signature = Signature.from_string(signatureString);
  return signature.verifyValue(address, signatureMessage(intentHash));
}

export async function getLatestBlockTimestamp() {
  const networkClient = await getNetworkClient();
  const latestBlock = await networkClient.getLatestBlock();
  const latestTimestamp = Number(latestBlock?.header?.metadata?.timestamp);

  if (!Number.isFinite(latestTimestamp)) {
    throw new Error("Could not read latest Aleo block timestamp");
  }

  return latestTimestamp;
}

export async function waitForTransactionVisible(transactionId, options = {}) {
  const { timeoutMs = INDEXING_TIMEOUT_MS, pollIntervalMs = INDEXING_POLL_INTERVAL_MS, onUpdate } = options;
  const networkClient = await getNetworkClient();
  const startedAt = Date.now();
  let lagNoticeEmitted = false;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const transaction = await networkClient.getTransaction(transactionId);
      onUpdate?.({
        type: "visible",
        elapsedMs: Date.now() - startedAt,
        transactionId,
      });
      return transaction;
    } catch (error) {
      if (!isTransactionLookupMiss(error)) {
        throw error;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (!lagNoticeEmitted && elapsedMs >= INDEXING_LAG_NOTICE_MS) {
      lagNoticeEmitted = true;
      onUpdate?.({
        type: "lagging",
        elapsedMs,
        transactionId,
      });
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Transaction indexing timed out for ${transactionId}`);
}
