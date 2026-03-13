import manifest from "../artifact-manifest.json" with { type: "json" };

import {
  FUNCTION_ID,
  MERKLE_DEPTH,
  PROGRAM_ID,
  RELAY_AUTHORIZATION_FIELDS,
  UPSTREAM_ARTIFACT_VERSION,
  UPSTREAM_VERSION,
  VERIFIER_PUBLIC_TUPLE
} from "./constants.mjs";

export function validateManifest(candidate = manifest) {
  if (candidate.upstream?.git_tag !== UPSTREAM_VERSION) {
    throw new Error(`unexpected upstream version: ${candidate.upstream?.git_tag}`);
  }

  if (candidate.upstream?.artifact_version !== UPSTREAM_ARTIFACT_VERSION) {
    throw new Error(
      `unexpected upstream artifact version: ${candidate.upstream?.artifact_version}`
    );
  }

  const profile = candidate.aleo_v1_profile;
  if (!profile) {
    throw new Error("missing aleo_v1_profile");
  }

  if (JSON.stringify(profile.supported_depths) !== JSON.stringify([MERKLE_DEPTH])) {
    throw new Error(`unexpected supported depths: ${JSON.stringify(profile.supported_depths)}`);
  }

  if (profile.program_id !== PROGRAM_ID) {
    throw new Error(`unexpected program id: ${profile.program_id}`);
  }

  if (profile.function_id !== FUNCTION_ID) {
    throw new Error(`unexpected function id: ${profile.function_id}`);
  }

  if (JSON.stringify(profile.verifier_public_tuple) !== JSON.stringify(VERIFIER_PUBLIC_TUPLE)) {
    throw new Error("unexpected verifier public tuple");
  }

  if (profile.message_representation !== "public_split128_bytes32") {
    throw new Error("v1 must keep the public split128 message representation");
  }

  if (profile.scope_representation !== "keccak256(bytes32(normalized_scope)) >> 8") {
    throw new Error("v1 must keep the hashed scope representation");
  }

  if (profile.tree_model !== "padded_lean_imt") {
    throw new Error("v1 must keep the padded LeanIMT tree model");
  }

  if (profile.batch_insertion !== false) {
    throw new Error("v1 must keep batch insertion disabled");
  }

  if (profile.member_removal_semantics !== "replace_leaf_with_zero") {
    throw new Error("v1 must replace removed members with zero");
  }

  if (profile.root_history_policy !== "retain_all") {
    throw new Error("v1 must retain all historical roots");
  }

  if (JSON.stringify(candidate.relay_authorization?.fields) !== JSON.stringify(RELAY_AUTHORIZATION_FIELDS)) {
    throw new Error("unexpected relay authorization field list");
  }

  return true;
}
