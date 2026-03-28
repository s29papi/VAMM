import { pathToFileURL } from "node:url";

import {
  PROGRAM_ID,
  createContext,
  isProgramDeployed,
  loadProgramSource,
  stringifyJson,
  waitForConfirmation
} from "./private-agent-swap-common.mjs";

async function main() {
  const context = createContext("ALEOVEIL_TESTNET_PRIVATE_KEY");

  if (await isProgramDeployed(context.networkClient)) {
    process.stdout.write(stringifyJson({
      program: PROGRAM_ID,
      endpoint: context.endpoint,
      deployed: true,
      skipped: true
    }));
    process.stdout.write("\n");
    return;
  }

  const programSource = await loadProgramSource();
  const transactionId = await context.programManager.deploy(programSource, 0, false);
  process.stderr.write(`deployment transaction submitted: ${transactionId}\n`);
  await waitForConfirmation(context.networkClient, transactionId);

  process.stdout.write(stringifyJson({
    program: PROGRAM_ID,
    endpoint: context.endpoint,
    deployed: true,
    transactionId
  }));
  process.stdout.write("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
  });
}
