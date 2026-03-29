import { field, i64, u128, u64 } from "../requester-intent";

function buildCreatePrivateCreditsRecordTransactionOptions({
  ownerAddress,
  amountMicrocredits,
  fee,
  privateFee = false,
}) {
  return {
    program: "credits.aleo",
    function: "transfer_public_to_private",
    inputs: [ownerAddress, u64(amountMicrocredits)],
    fee,
    privateFee,
  };
}

function buildSettlementInputs({
  orderId,
  approvalAmount,
  privateCreditsRecord,
  requesterPublicAddress,
  requesterPrivateAddress,
  recipientPublicAddress,
  recipientPrivateAddress,
  minPayoutMicrocredits,
  maxPayoutMicrocredits,
  expiryTimestamp,
  boundsHash,
  ephemeralSignerAddress,
  signature,
}) {
  return [
    u64(orderId),
    u128(approvalAmount),
    privateCreditsRecord,
    requesterPublicAddress,
    requesterPrivateAddress,
    recipientPublicAddress,
    recipientPrivateAddress,
    u64(minPayoutMicrocredits),
    u64(maxPayoutMicrocredits),
    i64(expiryTimestamp),
    field(boundsHash),
    ephemeralSignerAddress,
    signature,
  ];
}

function buildSettlementInputBundle(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("payload is required to build settlement inputs");
  }

  const {
    privateCreditsRecord,
    requesterPublicAddress = payload.requester,
    requesterPrivateAddress = payload.requester,
    recipientPublicAddress = payload.recipient ?? payload.requester,
    recipientPrivateAddress = payload.recipient ?? payload.requester,
    minPayoutMicrocredits = payload.min_payout,
    maxPayoutMicrocredits = payload.max_payout,
    approvalAmount = payload.approval_amount,
    orderId = payload.order_id,
    expiryTimestamp = payload.expiry_timestamp,
    boundsHash = payload.bounds_hash,
    ephemeralSignerAddress = payload.ephemeral_signer,
    signature = payload.signature,
  } = options;

  if (typeof privateCreditsRecord !== "string" || privateCreditsRecord.trim().length === 0) {
    throw new Error("privateCreditsRecord is required");
  }

  return {
    program: options.program ?? payload.program ?? "vammsettlementv10.aleo",
    function: "settle_order",
    inputs: buildSettlementInputs({
      orderId,
      approvalAmount,
      privateCreditsRecord: privateCreditsRecord.trim(),
      requesterPublicAddress,
      requesterPrivateAddress,
      recipientPublicAddress,
      recipientPrivateAddress,
      minPayoutMicrocredits,
      maxPayoutMicrocredits,
      expiryTimestamp,
      boundsHash,
      ephemeralSignerAddress,
      signature,
    }),
  };
}

export {
  buildCreatePrivateCreditsRecordTransactionOptions,
  buildSettlementInputBundle,
  buildSettlementInputs,
};
