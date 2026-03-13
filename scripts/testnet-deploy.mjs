import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { Account } from "@provablehq/sdk";

import { PROGRAM_ID } from "../src/constants.mjs";
import { getTestnetConfig, isProgramDeployed, getPublicBalance } from "./testnet-common.mjs";

function runLeoDeploy({ endpoint, privateKey }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "leo",
      [
        "deploy",
        "--broadcast",
        "--yes",
        "--network",
        "testnet",
        "--endpoint",
        endpoint,
        "--private-key",
        privateKey,
        "--path",
        "/home/usih/go/src/github.com/searchbox-labs/aleoveil"
      ],
      {
        cwd: "/home/usih/go/src/github.com/searchbox-labs/aleoveil",
        stdio: "inherit",
        env: {
          ...process.env,
          NETWORK: "testnet",
          ENDPOINT: endpoint
        }
      }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`leo deploy exited with code ${code}`));
    });
  });
}

async function main() {
  const config = getTestnetConfig();
  const account = new Account({ privateKey: config.adminPrivateKey });
  const address = account.address().to_string();
  const balance = await getPublicBalance(config.endpoint, address);

  process.stdout.write(`Deployer address: ${address}\n`);
  process.stdout.write(`Public balance: ${balance.toString()} microcredits\n`);

  if (await isProgramDeployed(config.endpoint)) {
    process.stdout.write(`${PROGRAM_ID} is already deployed on testnet\n`);
    return;
  }

  process.stdout.write(`Deploying ${PROGRAM_ID} to testnet\n`);
  await runLeoDeploy({
    endpoint: config.endpoint,
    privateKey: config.adminPrivateKey
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
