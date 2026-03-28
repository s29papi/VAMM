import { Account, Signature } from "@provablehq/sdk";

function stringifyJson(value) {
  return JSON.stringify(
    value,
    (_, current) => (typeof current === "bigint" ? current.toString() : current),
    2,
  );
}

function getProbeAccount() {
  const privateKey = process.env.ALEOVEIL_REQUESTER_PRIVATE_KEY;
  if (privateKey) {
    return new Account({ privateKey });
  }
  return new Account();
}

function candidateMessages(fieldValue) {
  const decimal = String(fieldValue).replace(/field$/, "");
  return [
    `[${fieldValue}]`,
    fieldValue,
    decimal,
    `[${decimal}]`,
  ];
}

function trySignValue(privateKey, candidate) {
  try {
    const signature = Signature.signValue(privateKey, candidate);
    return {
      ok: true,
      signature: signature.to_string(),
      verifyValue: signature.verifyValue(privateKey.to_address(), candidate),
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
    };
  }
}

function signBytes(privateKey, candidate) {
  const bytes = new TextEncoder().encode(candidate);
  const signature = Signature.sign(privateKey, bytes);
  return {
    signature: signature.to_string(),
    verifyBytes: signature.verify(privateKey.to_address(), bytes),
  };
}

function compareCandidate(privateKey, candidate) {
  const valueResult = trySignValue(privateKey, candidate);
  const byteResult = signBytes(privateKey, candidate);

  return {
    candidate,
    signValue: valueResult,
    signMessageEquivalent: byteResult,
    signaturesMatch:
      valueResult.ok && valueResult.signature === byteResult.signature,
  };
}

async function main() {
  const account = getProbeAccount();
  const privateKey = account.privateKey();
  const address = account.address().to_string();
  const fieldValue =
    process.env.ALEOVEIL_PROBE_FIELD ??
    "1758525861451849146812692708032812616605017276878653650915254054600918526225field";

  const candidates = candidateMessages(fieldValue).map((candidate) =>
    compareCandidate(privateKey, candidate),
  );

  const result = {
    address,
    fieldValue,
    takeaway:
      "If signValue and byte-signing signatures differ for the same visible candidate, wallet signMessage cannot substitute for signValue under the current program design.",
    candidates,
  };

  process.stdout.write(stringifyJson(result));
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
