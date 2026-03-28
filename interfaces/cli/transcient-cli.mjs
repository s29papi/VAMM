import { executeRequesterOrder } from "../../scripts/execute-requester-order.mjs";

export async function runTranscientCli() {
  return executeRequesterOrder();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTranscientCli()
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2));
      process.stdout.write("\n");
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.message ?? error)}\n`);
      process.exitCode = 1;
    });
}
