import { mkdir, writeFile, readFile } from "node:fs/promises";
import process from "node:process";

import {
  createProfileFileContents,
  createWalletFileContents,
  getStatePaths
} from "./vamm-agent-cli.mjs";

async function readJsonFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function main() {
  try {
    const payload = await readJsonFromStdin();
    const agentName = String(payload.agentName ?? "").trim();
    const walletPassword = String(payload.walletPassword ?? "");
    const cwd = String(payload.cwd ?? process.cwd()).trim() || process.cwd();

    if (!agentName) {
      throw new Error("agent name is required");
    }
    if (!walletPassword) {
      throw new Error("wallet password is required");
    }

    const { STATE_DIR, WALLET_PATH, PROFILE_PATH } = getStatePaths(cwd);
    await mkdir(STATE_DIR, { recursive: true });

    const profile = createProfileFileContents(agentName);
    const wallet = createWalletFileContents(walletPassword);

    await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2));
    await writeFile(WALLET_PATH, JSON.stringify(wallet, null, 2));

    let savedWallet = wallet;
    try {
      savedWallet = JSON.parse(await readFile(WALLET_PATH, "utf8"));
    } catch {
      // Keep the in-memory wallet if re-read fails for any reason.
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      address: savedWallet.address,
      walletPath: WALLET_PATH,
      profilePath: PROFILE_PATH,
      agentName: profile.name
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: String(error?.message ?? error)
    }));
    process.exitCode = 1;
  }
}

main();
