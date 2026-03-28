import { Account } from "@provablehq/sdk";

import {
  createContext,
  PROGRAM_ID,
  submitDelegatedProving,
  waitForConfirmation
} from "./private-agent-swap-common.mjs";
import { u64 } from "./requester-intent-common.mjs";

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid numeric env var ${name}`);
  }

  return value;
}

function tryParsePrivateKeyEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }

  return new Account({ privateKey: raw });
}

function createEphemeralAccount() {
  return tryParsePrivateKeyEnv("ALEOVEIL_EPHEMERAL_PRIVATE_KEY") ?? new Account();
}

async function main() {
  const requester = createContext("ALEOVEIL_REQUESTER_PRIVATE_KEY");
  const ephemeral = createEphemeralAccount();
  const orderId = readNumber("ALEOVEIL_ORDER_ID", Date.now());
  const recipientAddress = process.env.ALEOVEIL_RECIPIENT_ADDRESS ?? requester.account.address().to_string();
  const waitForTx = String(process.env.ALEOVEIL_WAIT_FOR_CONFIRMATION ?? "true").toLowerCase() !== "false";

  const authorization = await submitDelegatedProving(requester, {
    programName: PROGRAM_ID,
    functionName: "authorize_order",
    inputs: [
      u64(orderId),
      ephemeral.address().to_string(),
      recipientAddress
    ]
  });

  const transactionId = authorization?.result?.transaction?.id;
  if (!transactionId) {
    throw new Error("authorize_order submission did not return a transaction id");
  }

  if (waitForTx) {
    await waitForConfirmation(requester.networkClient, transactionId);
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    programId: PROGRAM_ID,
    functionName: "authorize_order",
    requesterAddress: requester.account.address().to_string(),
    recipientAddress,
    orderId: String(orderId),
    ephemeralSignerAddress: ephemeral.address().to_string(),
    transactionId,
    confirmed: waitForTx
  }, null, 2));
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
