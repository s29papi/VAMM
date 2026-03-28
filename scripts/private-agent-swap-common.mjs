import { readFile } from "node:fs/promises";

import {
  Account,
  AleoNetworkClient,
  AleoKeyProvider,
  NetworkRecordProvider,
  Program,
  ProgramManager,
  RecordCiphertext
} from "@provablehq/sdk";

export const PROGRAM_ID = "vammsettlementv10.aleo";
export const DEFAULT_ENDPOINT = "https://api.provable.com/v2";
export const DEFAULT_PROVER_URL = "https://api.provable.com/prove/testnet";
export const PROGRAM_PATH = new URL("../src/vammsettlementv10.aleo", import.meta.url);

export function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`missing required environment variable: ${name}`);
  }

  return value;
}

export function stringifyJson(value) {
  return JSON.stringify(
    value,
    (_, current) => (typeof current === "bigint" ? current.toString() : current),
    2
  );
}

export async function loadProgramSource() {
  return readFile(PROGRAM_PATH, "utf8");
}

export async function resolveProgramAddress() {
  const source = await loadProgramSource();
  return Program.fromString(source).address().to_string();
}

export function createContext(privateKeyEnv) {
  const endpoint = process.env.ALEOVEIL_TESTNET_ENDPOINT ?? DEFAULT_ENDPOINT;
  const privateKey = requireEnv(privateKeyEnv);
  const account = new Account({ privateKey });
  const networkClient = new AleoNetworkClient(endpoint);
  const keyProvider = new AleoKeyProvider();
  const recordProvider = new NetworkRecordProvider(account, networkClient);
  const programManager = new ProgramManager(endpoint, keyProvider, recordProvider);

  keyProvider.useCache(true);
  programManager.setAccount(account);

  return {
    endpoint,
    privateKey,
    account,
    networkClient,
    programManager
  };
}

export async function waitForConfirmation(networkClient, transactionId) {
  return networkClient.waitForTransactionConfirmation(transactionId, 2_000, 180_000);
}

export async function isProgramDeployed(networkClient) {
  try {
    await networkClient.getProgram(PROGRAM_ID);
    return true;
  } catch (error) {
    if (/404|could not get URL|Program not found|Error fetching program/i.test(String(error?.message ?? error))) {
      return false;
    }

    throw error;
  }
}

export async function decryptOwnedRecordsFromTransaction(networkClient, transactionId, account) {
  const transaction = await networkClient.getTransaction(transactionId);
  const transitions = transaction?.execution?.transitions ?? transaction?.transaction?.execution?.transitions ?? [];
  const decrypted = [];

  for (const transition of transitions) {
    for (const output of transition.outputs ?? []) {
      const recordValue = output?.value;

      if (typeof recordValue !== "string" || !recordValue.startsWith("record1")) {
        continue;
      }

      const ciphertext = RecordCiphertext.fromString(recordValue);
      if (!ciphertext.isOwner(account.viewKey())) {
        continue;
      }

      decrypted.push(ciphertext.decrypt(account.viewKey()).toString());
    }
  }

  return decrypted;
}

export async function submitDelegatedProving(context, options) {
  const apiKey = requireEnv("PROVABLE_API_KEY");
  const consumerId = requireEnv("PROVABLE_CONSUMER_ID");
  const proverUrl = process.env.ALEOVEIL_DPS_URL ?? DEFAULT_PROVER_URL;
  const provingRequest = await context.programManager.provingRequest({
    ...options,
    privateKey: context.account.privateKey(),
    privateFee: false,
    priorityFee: 0,
    broadcast: true,
    useFeeMaster: true
  });

  const result = await context.networkClient.submitProvingRequestSafe({
    provingRequest,
    url: proverUrl,
    apiKey,
    consumerId,
    dpsPrivacy: true
  });

  if (!result.ok) {
    throw new Error(`delegated proving failed (${result.status}): ${result.error.message}`);
  }

  return {
    proverUrl,
    result: result.data
  };
}
