import { Account, Field, Signature } from "@provablehq/sdk";

function stringifyJson(value) {
  return JSON.stringify(
    value,
    (_, current) => (typeof current === "bigint" ? current.toString() : current),
    2,
  );
}

function getProbeAccount() {
  const privateKey = process.env.ALEOVEIL_REQUESTER_PRIVATE_KEY;
  return privateKey ? new Account({ privateKey }) : new Account();
}

function getFieldValues() {
  const raw = process.env.ALEOVEIL_PROBE_FIELDS;
  if (!raw) {
    return [
      "1758525861451849146812692708032812616605017276878653650915254054600918526225field",
      "4601963642792808067875420029075170254824807720317621098563886866612990718062field",
      "123456789field",
    ];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.endsWith("field") ? value : `${value}field`));
}

function buildValueCandidates(fields) {
  const candidates = [];

  if (fields[0]) {
    candidates.push({ label: "single_field_array", value: `[${fields[0]}]` });
    candidates.push({ label: "single_field", value: fields[0] });
  }

  if (fields[0] && fields[1]) {
    candidates.push({ label: "two_field_array", value: `[${fields[0]}, ${fields[1]}]` });
  }

  if (fields[0] && fields[1] && fields[2]) {
    candidates.push({ label: "three_field_array", value: `[${fields[0]}, ${fields[1]}, ${fields[2]}]` });
  }

  return candidates;
}

function buildMessageCandidates(fields) {
  const candidates = [];

  for (const valueCandidate of buildValueCandidates(fields)) {
    candidates.push({
      label: valueCandidate.label,
      message: valueCandidate.value,
    });
  }

  if (fields[0]) {
    candidates.push({
      label: "single_field_decimal",
      message: fields[0].replace(/field$/, ""),
    });
  }

  return candidates;
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function fieldBytes(fieldValue) {
  return Field.fromString(fieldValue).toBytesLe();
}

function buildPackedFieldCandidates(fields) {
  const candidates = [];

  if (fields[0]) {
    candidates.push({
      label: "packed_single_field_le",
      bytes: fieldBytes(fields[0]),
    });
  }

  if (fields[0] && fields[1]) {
    candidates.push({
      label: "packed_two_fields_le",
      bytes: concatBytes([fieldBytes(fields[0]), fieldBytes(fields[1])]),
    });
  }

  if (fields[0] && fields[1] && fields[2]) {
    candidates.push({
      label: "packed_three_fields_le",
      bytes: concatBytes([
        fieldBytes(fields[0]),
        fieldBytes(fields[1]),
        fieldBytes(fields[2]),
      ]),
    });
  }

  return candidates;
}

function bruteForce(account, fields) {
  const address = account.address();
  const privateKey = account.privateKey();
  const valueCandidates = buildValueCandidates(fields);
  const messageCandidates = buildMessageCandidates(fields).map((candidate) => ({
    ...candidate,
    encoding: "utf8_string_bytes",
    bytes: new TextEncoder().encode(candidate.message),
  }));
  const packedCandidates = buildPackedFieldCandidates(fields).map((candidate) => ({
    ...candidate,
    message: null,
    encoding: "canonical_field_bytes_le",
  }));

  return [...messageCandidates, ...packedCandidates].map((messageCandidate) => {
    const messageBytes = messageCandidate.bytes;
    const messageSignature = Signature.sign(privateKey, messageBytes);

    const verifiesAsBytes = messageSignature.verify(address, messageBytes);
    const valueChecks = valueCandidates.map((valueCandidate) => {
      let verifies = false;
      let error = null;

      try {
        verifies = messageSignature.verifyValue(address, valueCandidate.value);
      } catch (candidateError) {
        error = String(candidateError?.message ?? candidateError);
      }

      return {
        candidate: valueCandidate.label,
        value: valueCandidate.value,
        verifies,
        error,
      };
    });

    return {
      messageCandidate: messageCandidate.label,
      message: messageCandidate.message,
      encoding: messageCandidate.encoding,
      byteLength: messageBytes.length,
      signature: messageSignature.to_string(),
      verifiesAsBytes,
      valueChecks,
    };
  });
}

async function main() {
  const account = getProbeAccount();
  const fields = getFieldValues();
  const results = bruteForce(account, fields);

  process.stdout.write(
    stringifyJson({
      address: account.address().to_string(),
      fields,
      takeaway:
        "This probes whether a raw byte-signed message, including SDK-canonical field byte encodings, can verify as any Aleo value string the program could model with sign.verify over [field; N].",
      results,
    }),
  );
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
