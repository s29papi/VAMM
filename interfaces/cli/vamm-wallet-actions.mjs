import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { formatDecimal, getWalletBalances, getStatePaths } from "./vamm-agent-cli.mjs";

async function readJsonFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function loadState(baseDir) {
  const { WALLET_PATH, PROFILE_PATH } = getStatePaths(baseDir);
  let wallet = null;
  let profile = null;

  try {
    wallet = JSON.parse(await readFile(WALLET_PATH, "utf8"));
  } catch {}

  try {
    profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
  } catch {}

  return { wallet, profile, WALLET_PATH, PROFILE_PATH };
}

async function handleBalances(baseDir) {
  const { wallet, profile } = await loadState(baseDir);
  if (!wallet?.address) {
    throw new Error("wallet is not set up");
  }

  const balances = await getWalletBalances(wallet);
  return {
    ok: true,
    action: "balances",
    address: balances.address,
    profileName: profile?.name ?? null,
    balances: {
      aleoPublicMicrocredits: String(balances.aleoPublicMicrocredits),
      aleoPublicFormatted: formatDecimal(balances.aleoPublicMicrocredits),
      aleoPrivateMicrocredits: balances.aleoPrivateMicrocredits,
      usdcxPublicMicro: String(balances.usdcxPublicMicro),
      usdcxPublicFormatted: formatDecimal(balances.usdcxPublicMicro),
      usdcxPrivateMicro: balances.usdcxPrivateMicro,
    },
  };
}

async function handleReset(baseDir) {
  const { wallet, profile, WALLET_PATH, PROFILE_PATH } = await loadState(baseDir);
  await rm(WALLET_PATH, { force: true });
  await rm(PROFILE_PATH, { force: true });
  return {
    ok: true,
    action: "reset",
    removedWallet: Boolean(wallet),
    removedProfile: Boolean(profile),
  };
}

async function handleStatus(baseDir) {
  const { wallet, profile, WALLET_PATH, PROFILE_PATH } = await loadState(baseDir);
  return {
    ok: true,
    action: "status",
    walletExists: Boolean(wallet),
    profileExists: Boolean(profile),
    walletPath: WALLET_PATH,
    profilePath: PROFILE_PATH,
    address: wallet?.address ?? null,
    profileName: profile?.name ?? null,
  };
}

async function main() {
  try {
    const payload = await readJsonFromStdin();
    const action = String(payload.action ?? "status").trim().toLowerCase();
    const cwd = String(payload.cwd ?? process.cwd()).trim() || process.cwd();

    let result;
    if (action === "balances") {
      result = await handleBalances(cwd);
    } else if (action === "reset") {
      result = await handleReset(cwd);
    } else if (action === "status") {
      result = await handleStatus(cwd);
    } else {
      throw new Error(`unsupported action: ${action}`);
    }

    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: String(error?.message ?? error),
    }));
    process.exitCode = 1;
  }
}

main();
