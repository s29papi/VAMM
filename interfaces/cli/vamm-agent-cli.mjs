import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { Account, AleoNetworkClient } from "@provablehq/sdk";

const BANNER = String.raw`
██╗   ██╗ █████╗ ███╗   ███╗███╗   ███╗     █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██║   ██║██╔══██╗████╗ ████║████╗ ████║    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
██║   ██║███████║██╔████╔██║██╔████╔██║    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
╚██╗ ██╔╝██╔══██║██║╚██╔╝██║██║╚██╔╝██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
 ╚████╔╝ ██║  ██║██║ ╚═╝ ██║██║ ╚═╝ ██║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
  ╚═══╝  ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝     ╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝

                 v0.1.0
`;

const STATE_DIR = path.resolve(process.cwd(), ".vamm-agent");
const WALLET_PATH = path.join(STATE_DIR, "wallet.json");
const PROFILE_PATH = path.join(STATE_DIR, "profile.json");

export function getStatePaths(baseDir = process.cwd()) {
  const stateDir = path.resolve(baseDir, ".vamm-agent");
  return {
    STATE_DIR: stateDir,
    WALLET_PATH: path.join(stateDir, "wallet.json"),
    PROFILE_PATH: path.join(stateDir, "profile.json")
  };
}

async function pathExists(filePath) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function ensureStateDir() {
  await mkdir(STATE_DIR, { recursive: true });
}

export async function resetAgentState() {
  await rm(WALLET_PATH, { force: true });
  await rm(PROFILE_PATH, { force: true });
}

async function promptForAgentName() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = (await rl.question("Agent name: ")).trim();
    if (!answer) {
      throw new Error("agent name is required");
    }
    return answer;
  } finally {
    rl.close();
  }
}

async function promptForMenuSelection() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    process.stdout.write("\nOptions:\n");
    process.stdout.write("1. Balances\n");
    process.stdout.write("2. Reset state\n");
    process.stdout.write("3. Exit\n\n");
    return (await rl.question("Select option: ")).trim();
  } finally {
    rl.close();
  }
}

async function promptForConfirmation(message) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = (await rl.question(`${message} [y/N]: `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function promptForPassword(message) {
  if (!process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const answer = (await rl.question(`${message}: `)).trim();
      if (!answer) {
        throw new Error("password is required");
      }
      return answer;
    } finally {
      rl.close();
    }
  }

  process.stdout.write(`${message}: `);
  const stdin = process.stdin;
  const wasRaw = Boolean(stdin.isRaw);
  let password = "";

  try {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    while (true) {
      const [chunk] = await once(stdin, "data");
      const value = String(chunk);

      if (value === "\r" || value === "\n") {
        process.stdout.write("\n");
        break;
      }

      if (value === "\u0003") {
        process.stdout.write("\n");
        throw new Error("password entry cancelled");
      }

      if (value === "\u007f" || value === "\b") {
        password = password.slice(0, -1);
        continue;
      }

      password += value;
    }
  } finally {
    stdin.setRawMode(wasRaw);
  }

  password = password.trim();
  if (!password) {
    throw new Error("password is required");
  }
  return password;
}

async function promptForNewWalletPassword() {
  const password = await promptForPassword("Wallet password");
  const confirm = await promptForPassword("Confirm wallet password");
  if (password !== confirm) {
    throw new Error("wallet passwords do not match");
  }
  return password;
}

function encryptPrivateKey(privateKey, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function createWalletFileContents(password) {
  const account = new Account();
  return {
    kind: "hot-wallet",
    encryption: "password",
    createdAt: new Date().toISOString(),
    address: account.address().to_string(),
    encryptedPrivateKey: encryptPrivateKey(String(account.privateKey()), password)
  };
}

export function createProfileFileContents(agentName) {
  return {
    name: agentName,
    createdAt: new Date().toISOString()
  };
}

export function formatDecimal(value, decimals = 6) {
  const amount = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  return `${whole}.${fraction.toString().padStart(decimals, "0")}`;
}

export async function getUsdcxPublicBalance(address, endpoint) {
  const response = await fetch(`${endpoint}/testnet/program/test_usdcx_stablecoin.aleo/mapping/balances/${address}`);
  if (response.status === 404) {
    return "0u128";
  }
  if (!response.ok) {
    throw new Error(`failed to fetch USDCx balance: ${response.status} ${await response.text()}`);
  }
  return JSON.parse(await response.text());
}

export async function getWalletBalances(wallet) {
  const endpoint = process.env.ALEOVEIL_TESTNET_ENDPOINT ?? "https://api.provable.com/v2";
  const networkClient = new AleoNetworkClient(endpoint);
  const address = wallet.address;

  const aleoPublic = BigInt(await networkClient.getPublicBalance(address));
  const usdcxPublicLiteral = await getUsdcxPublicBalance(address, endpoint);
  const usdcxPublic = BigInt(String(usdcxPublicLiteral).match(/^"?([0-9]+)/)?.[1] ?? "0");

  return {
    address,
    aleoPublicMicrocredits: aleoPublic,
    aleoPrivateMicrocredits: null,
    usdcxPublicMicro: usdcxPublic,
    usdcxPrivateMicro: null
  };
}

function renderBalancesView(profile, wallet, balances) {
  return `${BANNER}
Welcome. agent state found.

Status: idle
Agent: ${profile?.name ?? "unconfigured"}
Agent wallet: ${wallet?.address ?? "unconfigured"}
Profile: ${PROFILE_PATH}
Wallet: ${WALLET_PATH}

Balances:
- ALEO public (testnet): ${formatDecimal(balances.aleoPublicMicrocredits)}
- ALEO private (testnet): unavailable
- USDCx public (testnet): ${formatDecimal(balances.usdcxPublicMicro)}
- USDCx private (testnet): unavailable

Private balance scan: disabled in CLI to avoid testnet rate-limit errors
`;
}

async function initializeAgentFiles() {
  await ensureStateDir();
  process.stdout.write(`${BANNER}\n`);
  process.stdout.write("Welcome. No local agent state found.\n\n");
  const agentName = await promptForAgentName();
  process.stdout.write("\x1b[1A\x1b[2K");
  process.stdout.write("\nCreating local Aleo hot wallet...\n");
  const shouldCreateWallet = await promptForConfirmation("Proceed with wallet creation?");
  if (!shouldCreateWallet) {
    throw new Error("wallet creation cancelled");
  }
  const walletPassword = await promptForNewWalletPassword();
  const profile = {
    name: agentName,
    createdAt: new Date().toISOString()
  };
  const wallet = createWalletFileContents(walletPassword);

  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2));
  await writeFile(WALLET_PATH, JSON.stringify(wallet, null, 2));

  return { profile, wallet, rendered: true };
}

async function ensureAgentBootstrap() {
  const hasWallet = await pathExists(WALLET_PATH);
  const hasProfile = await pathExists(PROFILE_PATH);

  if (!hasWallet && !hasProfile) {
    return initializeAgentFiles();
  }

  await ensureStateDir();

  const profile = hasProfile
    ? JSON.parse(await readFile(PROFILE_PATH, "utf8"))
    : null;
  let wallet = hasWallet
    ? JSON.parse(await readFile(WALLET_PATH, "utf8"))
    : null;

  if (!wallet) {
    process.stdout.write("\nNo wallet file found.\n");
    process.stdout.write("Creating local Aleo hot wallet...\n");
    const shouldCreateWallet = await promptForConfirmation("Proceed with wallet creation?");
    if (!shouldCreateWallet) {
      throw new Error("wallet creation cancelled");
    }
    const walletPassword = await promptForNewWalletPassword();
    wallet = createWalletFileContents(walletPassword);
    await writeFile(WALLET_PATH, JSON.stringify(wallet, null, 2));
  }

  return { profile, wallet, rendered: false };
}

export function renderVammAgentCli(profile, wallet) {
  const isConfigured = Boolean(profile?.name);
  return `${BANNER}
Status: ${isConfigured ? "idle" : "setup"}
Agent: ${profile?.name ?? "unconfigured"}
Agent wallet: ${wallet?.address ?? "unconfigured"}
Profile: ${PROFILE_PATH}
Wallet: ${WALLET_PATH}
`;
}

export function renderVammAgentState(profile, wallet) {
  const isConfigured = Boolean(profile?.name);
  return `Status: ${isConfigured ? "idle" : "setup"}
Agent: ${profile?.name ?? "unconfigured"}
Agent wallet: ${wallet?.address ?? "unconfigured"}
Profile: ${PROFILE_PATH}
Wallet: ${WALLET_PATH}
`;
}

async function runCliShell() {
  const { profile, wallet, rendered } = await ensureAgentBootstrap();
  if (rendered) {
    process.stdout.write("\x1Bc");
    process.stdout.write(`${BANNER}\n`);
    process.stdout.write("Welcome. agent state found.\n\n");
    process.stdout.write(renderVammAgentState(profile, wallet));
    process.stdout.write("\n");
  } else {
    process.stdout.write(renderVammAgentCli(profile, wallet));
    process.stdout.write("\n");
  }

  while (true) {
    const selection = await promptForMenuSelection();
    if (selection === "1") {
      const balances = await getWalletBalances(wallet);
      process.stdout.write("\x1Bc");
      process.stdout.write(renderBalancesView(profile, wallet, balances));
      process.stdout.write("\n");
      continue;
    }
    if (selection === "2") {
      await resetAgentState();
      process.stdout.write("\nVAMM agent state cleared.\n");
      return;
    }
    process.stdout.write("\nExiting.\n");
    return;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCliShell()
    .catch((error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exitCode = 1;
    });
}
