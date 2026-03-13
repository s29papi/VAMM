import { EMPTY_ROOT, MERKLE_DEPTH } from "./constants.mjs";
import { AleoSemaphoreGroup } from "./group-state.mjs";
import {
  deriveNullifier,
  hashScope,
  identityCommitment,
  memberCommitmentKey,
  memberSlotKey,
  normalizeField,
  rebuildExistingRootFromAppend,
  rebuildMerkleRoot,
  rebuildNextRootFromAppend,
  rootKey
} from "./semantics.mjs";

function normalizeGroupId(groupId) {
  return normalizeField(groupId).toString();
}

function normalizeAddress(address) {
  if (typeof address !== "string" || address.length === 0) {
    throw new TypeError("addresses must be non-empty strings");
  }

  return address;
}

export class AleoSemaphorePortState {
  constructor() {
    this._initialized = false;
    this._owner = null;
    this._groups = new Map();

    this._initializedMapping = new Map();
    this._programAdminMapping = new Map();
    this._groupExists = new Map();
    this._groupAdmin = new Map();
    this._groupDepth = new Map();
    this._groupActiveMembers = new Map();
    this._groupNextIndex = new Map();
    this._groupRoot = new Map();
    this._groupRootValid = new Map();
    this._groupMember = new Map();
    this._groupMemberIndex = new Map();
    this._groupCommitmentActive = new Map();
    this._nullifierUsed = new Map();
  }

  get initialized() {
    return this._initialized;
  }

  get owner() {
    return this._owner;
  }

  initialize(owner) {
    if (this._initialized) {
      throw new Error("program already initialized");
    }

    const normalizedOwner = normalizeAddress(owner);
    this._initialized = true;
    this._owner = normalizedOwner;
    this._initializedMapping.set("0", true);
    this._programAdminMapping.set("0", normalizedOwner);
    return normalizedOwner;
  }

  transferOwnership(caller, nextOwner) {
    this._assertOwner(caller);
    const normalizedNextOwner = normalizeAddress(nextOwner);
    this._owner = normalizedNextOwner;
    this._programAdminMapping.set("0", normalizedNextOwner);
    return normalizedNextOwner;
  }

  createGroup({ caller, groupId, admin = caller }) {
    this._assertInitialized();

    const key = normalizeGroupId(groupId);
    if (this._groups.has(key)) {
      throw new Error(`group ${key} already exists`);
    }

    const tree = new AleoSemaphoreGroup();
    const normalizedAdmin = normalizeAddress(admin);
    const record = {
      admin: normalizedAdmin,
      tree
    };

    this._groups.set(key, record);
    this._groupExists.set(key, true);
    this._groupAdmin.set(key, normalizedAdmin);
    this._groupDepth.set(key, MERKLE_DEPTH);
    this._groupActiveMembers.set(key, 0);
    this._groupNextIndex.set(key, 0);
    this._groupRoot.set(key, EMPTY_ROOT.toString());
    this._groupRootValid.set(rootKey(groupId, EMPTY_ROOT).toString(), true);

    return this.getGroupState(groupId);
  }

  setGroupAdmin({ caller, groupId, nextAdmin }) {
    const group = this._requireGroup(groupId);
    this._assertGroupAdmin(group, caller);
    const normalizedNextAdmin = normalizeAddress(nextAdmin);
    group.admin = normalizedNextAdmin;
    this._groupAdmin.set(normalizeGroupId(groupId), normalizedNextAdmin);
    return this.getGroupState(groupId);
  }

  addMember({
    caller,
    groupId,
    newCommitment,
    currentRoot,
    merkleProofLength,
    merkleProofIndex,
    merkleProofSiblings
  }) {
    const group = this._requireGroup(groupId);
    this._assertGroupAdmin(group, caller);

    const normalizedCommitment = normalizeField(newCommitment);
    const normalizedCurrentRoot = normalizeField(currentRoot);
    const normalizedAppendIndex = normalizeField(merkleProofIndex);

    if (normalizedCommitment === 0n) {
      throw new Error("new commitments must be non-zero");
    }

    if (normalizedCurrentRoot !== group.tree.root) {
      throw new Error("current root does not match the stored group root");
    }

    if (normalizedAppendIndex !== BigInt(group.tree.nextIndex)) {
      throw new Error("append witness index does not match the append cursor");
    }

    if (this.isCommitmentActive(groupId, normalizedCommitment)) {
      throw new Error("commitment is already active in the group");
    }

    const derivedCurrentRoot = rebuildExistingRootFromAppend(
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );
    if (derivedCurrentRoot !== normalizedCurrentRoot) {
      throw new Error("append witness does not match the current root");
    }

    const nextRoot = rebuildNextRootFromAppend(
      normalizedCommitment,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );

    const previousNextIndex = group.tree.nextIndex;
    group.tree.addMember(normalizedCommitment);
    if (group.tree.root !== nextRoot) {
      throw new Error("append witness derived an unexpected next root");
    }

    this._setGroupMember(groupId, previousNextIndex, normalizedCommitment);
    this._setCommitmentIndex(groupId, normalizedCommitment, previousNextIndex);
    this._setCommitmentActive(groupId, normalizedCommitment, true);
    this._syncGroupMappings(groupId, group);
    this._groupRootValid.set(rootKey(groupId, nextRoot).toString(), true);

    return this.getGroupState(groupId);
  }

  updateMember({
    caller,
    groupId,
    leafIndex,
    oldCommitment,
    newCommitment,
    currentRoot,
    merkleProofLength,
    merkleProofIndex,
    merkleProofSiblings
  }) {
    const group = this._requireGroup(groupId);
    this._assertGroupAdmin(group, caller);

    const normalizedLeafIndex = Number(normalizeField(leafIndex));
    const normalizedOldCommitment = normalizeField(oldCommitment);
    const normalizedNewCommitment = normalizeField(newCommitment);
    const normalizedCurrentRoot = normalizeField(currentRoot);

    if (normalizedNewCommitment === 0n) {
      throw new Error("new commitments must be non-zero");
    }

    if (normalizedOldCommitment === normalizedNewCommitment) {
      throw new Error("new commitments must differ from old commitments");
    }

    if (normalizedCurrentRoot !== group.tree.root) {
      throw new Error("current root does not match the stored group root");
    }

    const slotValue = group.tree.memberAt(normalizedLeafIndex);
    if (slotValue !== normalizedOldCommitment) {
      throw new Error("old commitment does not match the stored member slot");
    }

    if (normalizeField(merkleProofIndex) !== normalizeField(leafIndex)) {
      throw new Error("proof index must match the updated leaf index");
    }

    if (!this.isCommitmentActive(groupId, normalizedOldCommitment)) {
      throw new Error("old commitment is not active");
    }

    if (this.isCommitmentActive(groupId, normalizedNewCommitment)) {
      throw new Error("new commitment is already active");
    }

    const derivedCurrentRoot = rebuildMerkleRoot(
      normalizedOldCommitment,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );
    if (derivedCurrentRoot !== normalizedCurrentRoot) {
      throw new Error("Merkle proof does not match the current root");
    }

    const nextRoot = rebuildMerkleRoot(
      normalizedNewCommitment,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );

    group.tree.updateMember(normalizedLeafIndex, normalizedNewCommitment);
    if (group.tree.root !== nextRoot) {
      throw new Error("proof-derived root does not match the updated tree root");
    }

    this._clearCommitmentIndex(groupId, normalizedOldCommitment);
    this._setCommitmentActive(groupId, normalizedOldCommitment, false);
    this._setGroupMember(groupId, normalizedLeafIndex, normalizedNewCommitment);
    this._setCommitmentIndex(groupId, normalizedNewCommitment, normalizedLeafIndex);
    this._setCommitmentActive(groupId, normalizedNewCommitment, true);
    this._syncGroupMappings(groupId, group);
    this._groupRootValid.set(rootKey(groupId, nextRoot).toString(), true);

    return this.getGroupState(groupId);
  }

  removeMember({
    caller,
    groupId,
    leafIndex,
    oldCommitment,
    currentRoot,
    merkleProofLength,
    merkleProofIndex,
    merkleProofSiblings
  }) {
    const group = this._requireGroup(groupId);
    this._assertGroupAdmin(group, caller);

    const normalizedLeafIndex = Number(normalizeField(leafIndex));
    const normalizedOldCommitment = normalizeField(oldCommitment);
    const normalizedCurrentRoot = normalizeField(currentRoot);

    if (normalizedCurrentRoot !== group.tree.root) {
      throw new Error("current root does not match the stored group root");
    }

    if (normalizeField(merkleProofIndex) !== normalizeField(leafIndex)) {
      throw new Error("proof index must match the removed leaf index");
    }

    const slotValue = group.tree.memberAt(normalizedLeafIndex);
    if (slotValue !== normalizedOldCommitment) {
      throw new Error("old commitment does not match the stored member slot");
    }

    if (!this.isCommitmentActive(groupId, normalizedOldCommitment)) {
      throw new Error("old commitment is not active");
    }

    const derivedCurrentRoot = rebuildMerkleRoot(
      normalizedOldCommitment,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );
    if (derivedCurrentRoot !== normalizedCurrentRoot) {
      throw new Error("Merkle proof does not match the current root");
    }

    const nextRoot = rebuildMerkleRoot(
      0n,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );

    group.tree.removeMember(normalizedLeafIndex);
    if (group.tree.root !== nextRoot) {
      throw new Error("proof-derived root does not match the updated tree root");
    }

    this._setGroupMember(groupId, normalizedLeafIndex, 0n);
    this._clearCommitmentIndex(groupId, normalizedOldCommitment);
    this._setCommitmentActive(groupId, normalizedOldCommitment, false);
    this._syncGroupMappings(groupId, group);
    this._groupRootValid.set(rootKey(groupId, nextRoot).toString(), true);

    return this.getGroupState(groupId);
  }

  validateProof({
    groupId,
    merkleRoot,
    nullifier,
    message,
    scopeHash,
    identitySecret,
    merkleProofLength,
    merkleProofIndex,
    merkleProofSiblings
  }) {
    const group = this._requireGroup(groupId);
    const normalizedRoot = normalizeField(merkleRoot);
    const normalizedScopeHash = normalizeField(scopeHash);
    const normalizedNullifier = normalizeField(nullifier);
    const normalizedSecret = normalizeField(identitySecret);

    if (!group.tree.hasRoot(normalizedRoot)) {
      throw new Error("Merkle root is not valid for the group");
    }

    if (this.isNullifierUsed(normalizedNullifier)) {
      throw new Error(`nullifier already used: ${normalizedNullifier}`);
    }

    const derivedCommitment = identityCommitment(normalizedSecret);
    const derivedRoot = rebuildMerkleRoot(
      derivedCommitment,
      merkleProofLength,
      merkleProofIndex,
      merkleProofSiblings
    );
    if (derivedRoot !== normalizedRoot) {
      throw new Error("Merkle proof does not match the supplied root");
    }

    const derivedNullifier = deriveNullifier(normalizedSecret, normalizedScopeHash);
    if (derivedNullifier !== normalizedNullifier) {
      throw new Error("nullifier does not match the supplied identity and scope");
    }

    this.recordNullifier(normalizedNullifier);

    return {
      groupId: normalizeGroupId(groupId),
      merkleRoot: normalizedRoot.toString(),
      nullifier: normalizedNullifier.toString(),
      message: message.map((value) => normalizeField(value).toString()),
      scopeHash: normalizedScopeHash.toString()
    };
  }

  getGroupState(groupId) {
    const key = normalizeGroupId(groupId);
    const group = this._requireGroup(groupId);

    return {
      groupId: key,
      admin: group.admin,
      merkleDepth: MERKLE_DEPTH,
      activeMembers: this._groupActiveMembers.get(key),
      nextIndex: this._groupNextIndex.get(key),
      root: this._groupRoot.get(key)
    };
  }

  getGroup(groupId) {
    return this._requireGroup(groupId).tree;
  }

  getGroupAdmin(groupId) {
    return this._groupAdmin.get(normalizeGroupId(groupId));
  }

  hasHistoricalRoot(groupId, root) {
    return this._groupRootValid.get(rootKey(groupId, root).toString()) === true;
  }

  validateRoot({ groupId, root }) {
    return this.hasHistoricalRoot(groupId, root);
  }

  isCommitmentActive(groupId, commitment) {
    return (
      this._groupCommitmentActive.get(
        memberCommitmentKey(groupId, commitment).toString()
      ) === true
    );
  }

  isNullifierUsed(nullifier) {
    return this._nullifierUsed.get(normalizeField(nullifier).toString()) === true;
  }

  recordNullifier(nullifier) {
    const key = normalizeField(nullifier).toString();
    if (this._nullifierUsed.get(key) === true) {
      throw new Error(`nullifier already used: ${key}`);
    }

    this._nullifierUsed.set(key, true);
    return true;
  }

  getMappingValue(mappingName, key) {
    const maps = {
      initialized: this._initializedMapping,
      owner: this._programAdminMapping,
      program_admin: this._programAdminMapping,
      group_exists: this._groupExists,
      group_admin: this._groupAdmin,
      group_depth: this._groupDepth,
      group_active_members: this._groupActiveMembers,
      group_next_index: this._groupNextIndex,
      group_root: this._groupRoot,
      group_root_valid: this._groupRootValid,
      group_member: this._groupMember,
      group_member_index: this._groupMemberIndex,
      group_commitment_active: this._groupCommitmentActive,
      nullifier_used: this._nullifierUsed
    };

    const mapping = maps[mappingName];
    if (!mapping) {
      throw new Error(`unknown mapping: ${mappingName}`);
    }

    return mapping.get(String(key));
  }

  _assertInitialized() {
    if (!this._initialized) {
      throw new Error("program is not initialized");
    }
  }

  _assertOwner(caller) {
    this._assertInitialized();
    if (normalizeAddress(caller) !== this._owner) {
      throw new Error("caller is not the owner");
    }
  }

  _assertGroupAdmin(group, caller) {
    if (group.admin !== normalizeAddress(caller)) {
      throw new Error("caller is not the group admin");
    }
  }

  _requireGroup(groupId) {
    const key = normalizeGroupId(groupId);
    const group = this._groups.get(key);
    if (!group) {
      throw new Error(`group ${key} does not exist`);
    }

    return group;
  }

  _syncGroupMappings(groupId, group) {
    const key = normalizeGroupId(groupId);
    this._groupActiveMembers.set(key, group.tree.size);
    this._groupNextIndex.set(key, group.tree.nextIndex);
    this._groupRoot.set(key, group.tree.root.toString());
  }

  _setGroupMember(groupId, leafIndex, commitment) {
    this._groupMember.set(
      memberSlotKey(groupId, leafIndex).toString(),
      normalizeField(commitment).toString()
    );
  }

  _setCommitmentIndex(groupId, commitment, leafIndex) {
    this._groupMemberIndex.set(
      memberCommitmentKey(groupId, commitment).toString(),
      Number(leafIndex)
    );
  }

  _clearCommitmentIndex(groupId, commitment) {
    this._groupMemberIndex.delete(memberCommitmentKey(groupId, commitment).toString());
  }

  _setCommitmentActive(groupId, commitment, isActive) {
    this._groupCommitmentActive.set(
      memberCommitmentKey(groupId, commitment).toString(),
      Boolean(isActive)
    );
  }
}
