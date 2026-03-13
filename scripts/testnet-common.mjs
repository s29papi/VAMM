import { Account, AleoNetworkClient, ProgramManager } from "@provablehq/sdk";

import { PROGRAM_ID } from "../src/constants.mjs";

export function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === "") {
    throw new Error(`missing required environment variable: ${name}`);
  }

  return value;
}

export function getTestnetConfig() {
  const endpoint = requireEnv("ALEOVEIL_TESTNET_ENDPOINT", "https://api.explorer.provable.com/v2");
  const adminPrivateKey = requireEnv("ALEOVEIL_TESTNET_PRIVATE_KEY");
  const userPrivateKey = process.env.ALEOVEIL_TESTNET_USER_PRIVATE_KEY || adminPrivateKey;
  const relayerUrl = process.env.ALEOVEIL_TESTNET_RELAYER_URL || "http://127.0.0.1:4040";
  const relayerBind = process.env.ALEOVEIL_TESTNET_RELAYER_BIND || "127.0.0.1";
  const relayerPort = Number(process.env.ALEOVEIL_TESTNET_RELAYER_PORT || "4040");

  return {
    endpoint,
    adminPrivateKey,
    userPrivateKey,
    relayerUrl,
    relayerBind,
    relayerPort
  };
}

export function createNetworkClient(endpoint) {
  return new AleoNetworkClient(endpoint);
}

export function createProgramManager(endpoint, privateKey) {
  const manager = new ProgramManager(endpoint);
  manager.setAccount(new Account({ privateKey }));
  return manager;
}

export async function getPublicBalance(endpoint, address) {
  const client = createNetworkClient(endpoint);
  return client.getPublicBalance(address);
}

export async function isProgramDeployed(endpoint) {
  const client = createNetworkClient(endpoint);

  try {
    await client.getProgram(PROGRAM_ID);
    return true;
  } catch (error) {
    if (/404|could not get URL|Error fetching program/i.test(String(error?.message ?? error))) {
      return false;
    }

    throw error;
  }
}
