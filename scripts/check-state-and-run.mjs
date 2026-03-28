import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { createContext, decryptOwnedRecordsFromTransaction, stringifyJson } from "./private-agent-swap-common.mjs";

const execFileAsync = promisify(execFile);
const API_BASE = "https://api.provable.com/v2/testnet";

function parseAleoLiteral(value) {
  const match = String(value).match(/^"?([0-9]+)/);
  return BigInt(match?.[1] ?? "0");
}

async function getUsdcxPublicBalance(address) {
  const response = await fetch(`${API_BASE}/program/test_usdcx_stablecoin.aleo/mapping/balances/${address}`);
  if (response.status === 404) {
    return "0u128";
  }
  if (!response.ok) {
    throw new Error(`failed to fetch USDCx balance for ${address}: ${response.status} ${await response.text()}`);
  }
  return JSON.parse(await response.text());
}

async function snapshot(maker, requester, label) {
  const makerAddress = maker.account.address().to_string();
  const requesterAddress = requester.account.address().to_string();

  return {
    label,
    maker: {
      address: makerAddress,
      aleoPublicMicrocredits: String(await maker.networkClient.getPublicBalance(makerAddress)),
      usdcxPublic: await getUsdcxPublicBalance(makerAddress)
    },
    requester: {
      address: requesterAddress,
      aleoPublicMicrocredits: String(await requester.networkClient.getPublicBalance(requesterAddress)),
      usdcxPublic: await getUsdcxPublicBalance(requesterAddress)
    }
  };
}

function extractJson(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  const start = combined.indexOf('{\n  "aleoUsdPrice"');
  if (start === -1) {
    throw new Error(`could not find JSON in CLI output:\n${combined}`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < combined.length; i += 1) {
    const char = combined[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(combined.slice(start, i + 1));
      }
    }
  }

  throw new Error(`could not parse JSON in CLI output:\n${combined}`);
}

async function main() {
  const maker = createContext("ALEOVEIL_TESTNET_PRIVATE_KEY");
  const requester = createContext("ALEOVEIL_REQUESTER_PRIVATE_KEY");

  const before = await snapshot(maker, requester, "before");

  const { stdout, stderr } = await execFileAsync("node", ["scripts/vamm-agent-cli.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });

  const run = extractJson(stdout, stderr);
  const after = await snapshot(maker, requester, "after");
  const makerSettlementRecords = await decryptOwnedRecordsFromTransaction(maker.networkClient, run.settlementTx, maker.account);
  const requesterSettlementRecords = await decryptOwnedRecordsFromTransaction(requester.networkClient, run.settlementTx, requester.account);

  process.stdout.write(stringifyJson({
    before,
    run,
    after,
    deltas: {
      maker: {
        aleoPublicMicrocredits: String(parseAleoLiteral(after.maker.aleoPublicMicrocredits) - parseAleoLiteral(before.maker.aleoPublicMicrocredits)),
        usdcxPublic: String(parseAleoLiteral(after.maker.usdcxPublic) - parseAleoLiteral(before.maker.usdcxPublic))
      },
      requester: {
        aleoPublicMicrocredits: String(parseAleoLiteral(after.requester.aleoPublicMicrocredits) - parseAleoLiteral(before.requester.aleoPublicMicrocredits)),
        usdcxPublic: String(parseAleoLiteral(after.requester.usdcxPublic) - parseAleoLiteral(before.requester.usdcxPublic))
      }
    },
    decryptedSettlementRecords: {
      maker: makerSettlementRecords,
      requester: requesterSettlementRecords
    }
  }));
  process.stdout.write("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
