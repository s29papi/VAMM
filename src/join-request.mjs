import { normalizeField } from "./semantics.mjs";

export function buildJoinRequest({ groupId, identityCommitment }) {
  return {
    groupId: normalizeField(groupId).toString(),
    identityCommitment: normalizeField(identityCommitment).toString()
  };
}
