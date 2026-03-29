const CREDITS_PROGRAM_ID = "credits.aleo";
const CREDITS_RECORD_NAME = "credits";

function toBigInt(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return BigInt(value.trim());
  }

  return null;
}

function parseCreditsRecordPlaintext(recordPlaintext) {
  if (typeof recordPlaintext !== "string") {
    return null;
  }

  const microcreditsMatch = recordPlaintext.match(/microcredits:\s*([0-9]+)u64\.private/i);
  if (!microcreditsMatch) {
    return null;
  }

  const ownerMatch = recordPlaintext.match(/owner:\s*([a-z0-9]+)\.private/i);
  const nonceMatch = recordPlaintext.match(/_nonce:\s*([0-9]+)group\.public/i);
  const versionMatch = recordPlaintext.match(/_version:\s*([0-9]+)u8\.public/i);
  const microcredits = toBigInt(microcreditsMatch[1]);

  if (microcredits === null) {
    return null;
  }

  return {
    owner: ownerMatch?.[1] ?? null,
    microcredits,
    nonce: nonceMatch?.[1] ?? null,
    version: versionMatch?.[1] ?? null,
    recordPlaintext: recordPlaintext.trim(),
  };
}

function getRecordPlaintextCandidate(record) {
  if (typeof record === "string") {
    return record.trim();
  }

  if (!record || typeof record !== "object") {
    return null;
  }

  const candidates = [
    record.recordPlaintext,
    record.plaintext,
    record.record,
    record.value,
    record.ciphertext?.plaintext,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function normalizeCreditsRecordCandidate(record) {
  const recordPlaintext = getRecordPlaintextCandidate(record);
  const parsed = parseCreditsRecordPlaintext(recordPlaintext);

  if (!parsed) {
    return null;
  }

  const programName = typeof record === "object" && record ? record.programName ?? null : null;
  const recordName = typeof record === "object" && record ? record.recordName ?? null : null;
  const spent = typeof record === "object" && record ? Boolean(record.spent) : false;

  return {
    raw: record,
    programName,
    recordName,
    spent,
    recordPlaintext: parsed.recordPlaintext,
    owner: parsed.owner,
    microcredits: parsed.microcredits,
    nonce: parsed.nonce,
    version: parsed.version,
    spendable:
      !spent &&
      (programName === null || programName === CREDITS_PROGRAM_ID) &&
      (recordName === null || recordName === CREDITS_RECORD_NAME) &&
      parsed.microcredits > 0n,
  };
}

function extractCreditsRecordCandidates(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map(normalizeCreditsRecordCandidate)
    .filter((candidate) => candidate !== null);
}

function selectSpendableCreditsRecord(records, options = {}) {
  const { minimumMicrocredits = 1n, maximumMicrocredits = null, preferLargest = true } = options;
  const threshold = toBigInt(minimumMicrocredits) ?? 1n;
  const ceiling = maximumMicrocredits === null ? null : toBigInt(maximumMicrocredits);

  const candidates = extractCreditsRecordCandidates(records).filter(
    (candidate) =>
      candidate.spendable &&
      candidate.microcredits >= threshold &&
      (ceiling === null || candidate.microcredits <= ceiling),
  );

  if (candidates.length === 0) {
    return null;
  }

  if (!preferLargest) {
    return candidates[0];
  }

  return candidates.reduce((best, current) =>
    current.microcredits > best.microcredits ? current : best,
  );
}

function formatCreditsRecordSummary(candidate) {
  if (!candidate) {
    return null;
  }

  return {
    microcredits: candidate.microcredits.toString(),
    owner: candidate.owner,
    spendable: candidate.spendable,
    spent: candidate.spent,
    recordPlaintext: candidate.recordPlaintext,
  };
}

export {
  CREDITS_PROGRAM_ID,
  CREDITS_RECORD_NAME,
  extractCreditsRecordCandidates,
  formatCreditsRecordSummary,
  normalizeCreditsRecordCandidate,
  parseCreditsRecordPlaintext,
  selectSpendableCreditsRecord,
};
