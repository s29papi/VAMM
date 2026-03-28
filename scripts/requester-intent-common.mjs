import { Address, Plaintext, Poseidon2, Signature } from "@provablehq/sdk";

export function u64(value) {
  return `${value}u64`;
}

export function u128(value) {
  return `${value}u128`;
}

export function i64(value) {
  return `${value}i64`;
}

export function field(value) {
  return typeof value === "string" && value.endsWith("field") ? value : `${value}field`;
}

export function buildBoundsHash(minPayout, maxPayout) {
  const plaintext = Plaintext.fromString(
    `{ min_payout: ${u64(Number(minPayout))}, max_payout: ${u64(Number(maxPayout))} }`
  );
  return new Poseidon2().hash(plaintext.toFieldsRaw(), "field").toString();
}

export function buildIntentHash(
  orderId,
  approvalAmount,
  requesterAddress,
  expiryTimestamp,
  boundsHash,
  recipientAddress = requesterAddress
) {
  const plaintext = Plaintext.fromString(
    `{ order_id: ${u64(Number(orderId))}, approval_amount: ${u128(approvalAmount)}, requester: ${requesterAddress}, recipient: ${recipientAddress}, expiry_timestamp: ${i64(Number(expiryTimestamp))}, bounds_hash: ${field(boundsHash)} }`
  );
  return new Poseidon2().hash(plaintext.toFieldsRaw(), "field").toString();
}

export function signatureMessage(intentHash) {
  return `[${field(intentHash)}]`;
}

export function signIntent(privateKey, intentHash) {
  return Signature.signValue(privateKey, signatureMessage(intentHash)).to_string();
}

export function verifyIntent(addressValue, signatureString, intentHash) {
  const address = Address.from_string(addressValue);
  const signature = Signature.from_string(signatureString);
  return signature.verifyValue(address, signatureMessage(intentHash));
}

export function verifyRequesterIntent(requesterAddress, signatureString, intentHash) {
  return verifyIntent(requesterAddress, signatureString, intentHash);
}
