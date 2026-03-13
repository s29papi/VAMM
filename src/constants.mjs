export const UPSTREAM_VERSION = "v4.13.0";
export const UPSTREAM_ARTIFACT_VERSION = "4.13.0";

export const MERKLE_DEPTH = 20;
export const MAX_GROUP_SIZE = 2 ** MERKLE_DEPTH;

export const PROGRAM_ID = "veil_semaphore_v1.aleo";
export const FUNCTION_ID = "validate_proof_depth_20";

export const EMPTY_ROOT = 0n;

export const IDENTITY_DOMAIN = 1n;
export const NULLIFIER_DOMAIN = 3n;
export const ROOT_HISTORY_DOMAIN = 4n;
export const MEMBER_SLOT_DOMAIN = 5n;
export const MEMBER_COMMITMENT_DOMAIN = 6n;

export const VERIFIER_PUBLIC_TUPLE = Object.freeze([
  "merkleRoot",
  "nullifier",
  "message[0]",
  "message[1]",
  "scopeHash"
]);

export const RELAY_AUTHORIZATION_FIELDS = Object.freeze([
  "program_id",
  "function_id",
  "group_id",
  "merkle_root",
  "nullifier",
  "message",
  "scope_hash",
  "deadline",
  "nonce"
]);

export const DEVNET_PRIVATE_KEY =
  "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH";
