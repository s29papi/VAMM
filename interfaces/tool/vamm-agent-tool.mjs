import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";

import {
  createMockQuote,
  createMockSettlement,
  getMockCapabilities
} from "./vamm-agent-mock-runtime.mjs";

const STATE_DIR = path.resolve(process.cwd(), ".vamm-agent");
const WALLET_PATH = path.join(STATE_DIR, "wallet.json");
const PROFILE_PATH = path.join(STATE_DIR, "profile.json");

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] ?? "status";
  const flags = {};

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { command, flags };
}

async function getStateSnapshot() {
  const [profile, wallet] = await Promise.all([
    readJsonIfPresent(PROFILE_PATH),
    readJsonIfPresent(WALLET_PATH)
  ]);

  return {
    status: profile?.name && wallet?.address ? "idle" : "setup",
    profile,
    wallet,
    paths: {
      profile: PROFILE_PATH,
      wallet: WALLET_PATH
    }
  };
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runCommand() {
  const { command, flags } = parseArgs(process.argv);
  const snapshot = await getStateSnapshot();

  if (command === "status") {
    printJson({
      kind: "status",
      state: snapshot,
      capabilities: getMockCapabilities()
    });
    return;
  }

  if (command === "balances") {
    printJson({
      kind: "balances",
      mode: "mock",
      state: snapshot,
      balances: {
        aleoPublic: "0.000000",
        aleoPrivate: "unavailable",
        usdcxPublic: "0.000000",
        usdcxPrivate: "unavailable"
      },
      notes: [
        "tool mode is returning placeholder balances",
        "replace with live balance fetchers when wiring the real backend"
      ]
    });
    return;
  }

  if (command === "quote") {
    printJson({
      state: snapshot,
      quote: createMockQuote({
        targetAleo: flags["target-aleo"] ? Number(flags["target-aleo"]) : undefined,
        bufferBps: flags["buffer-bps"] ? Number(flags["buffer-bps"]) : undefined
      })
    });
    return;
  }

  if (command === "settle") {
    printJson({
      state: snapshot,
      settlement: createMockSettlement({
        requester: flags.requester ?? snapshot.wallet?.address,
        maker: flags.maker,
        targetAleo: flags["target-aleo"] ? Number(flags["target-aleo"]) : undefined,
        approvalUsdcx: flags["approval-usdcx"]
      })
    });
    return;
  }

  process.stderr.write(`unknown command: ${command}\n`);
  process.exitCode = 1;
}

runCommand().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
