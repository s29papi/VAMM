import {
  EMPTY_ROOT,
  MAX_GROUP_SIZE,
  MERKLE_DEPTH
} from "./constants.mjs";
import {
  assertGroupCapacity,
  normalizeField,
  padSiblings,
  rebuildExistingRootFromAppend,
  rebuildMerkleRoot,
  rebuildNextRootFromAppend,
  treeHash
} from "./semantics.mjs";

function computeNextLevel(nodes) {
  if (nodes.length <= 1) {
    return [...nodes];
  }

  const next = [];
  for (let i = 0; i < nodes.length; i += 2) {
    const left = nodes[i];
    const right = nodes[i + 1];
    next.push(right === undefined ? left : treeHash(left, right));
  }

  return next;
}

function computeRoot(leaves) {
  if (leaves.length === 0) {
    return EMPTY_ROOT;
  }

  let level = leaves.map(normalizeField);
  while (level.length > 1) {
    level = computeNextLevel(level);
  }

  return level[0];
}

function cloneLeaves(leaves) {
  return leaves.map((leaf) => normalizeField(leaf));
}

export class AleoSemaphoreGroup {
  constructor(members = []) {
    this._leaves = [];
    this._nextIndex = 0;
    this._activeMembers = 0;
    this._root = EMPTY_ROOT;
    this._rootHistory = new Set([EMPTY_ROOT.toString()]);

    for (const member of members) {
      this.addMember(member);
    }
  }

  static import(serialized) {
    const instance = new AleoSemaphoreGroup();
    const leaves = Array.isArray(serialized?.leaves) ? serialized.leaves.map(normalizeField) : [];

    instance._leaves = leaves;
    instance._nextIndex = Number(serialized?.nextIndex ?? leaves.length);
    instance._activeMembers = leaves.filter((leaf) => leaf !== 0n).length;
    instance._root = computeRoot(leaves.slice(0, instance._nextIndex));
    instance._rootHistory = new Set(
      Array.isArray(serialized?.rootHistory)
        ? serialized.rootHistory.map((value) => normalizeField(value).toString())
        : [instance._root.toString()]
    );

    return instance;
  }

  get root() {
    return this._root;
  }

  get currentTreeDepth() {
    let width = this._nextIndex;
    let depth = 0;
    while (width > 1) {
      width = Math.ceil(width / 2);
      depth += 1;
    }

    return depth;
  }

  get merkleDepth() {
    return MERKLE_DEPTH;
  }

  get size() {
    return this._activeMembers;
  }

  get nextIndex() {
    return this._nextIndex;
  }

  get members() {
    return cloneLeaves(this._leaves.slice(0, this._nextIndex));
  }

  export() {
    return {
      leaves: this.members.map((value) => value.toString()),
      nextIndex: this._nextIndex,
      rootHistory: [...this._rootHistory]
    };
  }

  memberAt(index) {
    if (index < 0 || index >= this._nextIndex) {
      throw new RangeError(`member index out of range: ${index}`);
    }

    return this._leaves[index];
  }

  indexOf(member) {
    const normalized = normalizeField(member);
    return this._leaves.slice(0, this._nextIndex).findIndex((leaf) => leaf === normalized);
  }

  hasRoot(root) {
    return this._rootHistory.has(normalizeField(root).toString());
  }

  isActive(member) {
    const index = this.indexOf(member);
    return index >= 0 && this._leaves[index] !== 0n;
  }

  generateMerkleProof(index) {
    if (index < 0 || index >= this._nextIndex) {
      throw new RangeError(`member index out of range: ${index}`);
    }

    let nodes = cloneLeaves(this._leaves.slice(0, this._nextIndex));
    let cursor = index;
    let proofIndex = 0n;
    let bitPosition = 0n;
    const siblings = [];

    while (nodes.length > 1) {
      const siblingIndex = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
      if (siblingIndex < nodes.length) {
        siblings.push(nodes[siblingIndex]);
        if (cursor % 2 === 1) {
          proofIndex |= 1n << bitPosition;
        }

        bitPosition += 1n;
      }

      nodes = computeNextLevel(nodes);
      cursor = Math.floor(cursor / 2);
    }

    return {
      merkleRoot: this.root,
      merkleProofLength: siblings.length,
      merkleProofIndex: proofIndex,
      merkleProofSiblings: padSiblings(siblings),
      leaf: this._leaves[index],
      leafIndex: index
    };
  }

  generateAppendWitness() {
    assertGroupCapacity(this._nextIndex);

    let nodes = cloneLeaves(this._leaves.slice(0, this._nextIndex));
    let cursor = this._nextIndex;
    const siblings = Array.from({ length: MERKLE_DEPTH }, () => 0n);
    let proofLength = 0;

    for (let level = 0; level < MERKLE_DEPTH && cursor > 0; level += 1) {
      if (cursor % 2 === 1) {
        siblings[level] = nodes[cursor - 1];
        proofLength += 1;
      }

      nodes = computeNextLevel(nodes);
      cursor = Math.floor(cursor / 2);
    }

    return {
      merkleRoot: this.root,
      merkleProofLength: proofLength,
      merkleProofIndex: BigInt(this._nextIndex),
      merkleProofSiblings: siblings
    };
  }

  verifyMerkleProof(proof) {
    return (
      rebuildMerkleRoot(
        proof.leaf,
        proof.merkleProofLength,
        proof.merkleProofIndex,
        proof.merkleProofSiblings
      ) === normalizeField(proof.merkleRoot)
    );
  }

  previewAddMember(newCommitment, appendWitness = this.generateAppendWitness()) {
    const normalized = normalizeField(newCommitment);
    const currentRoot = normalizeField(appendWitness.merkleRoot);
    const appendIndex = appendWitness.merkleProofIndex;

    if (normalized === 0n) {
      throw new Error("new commitments must be non-zero");
    }

    if (this._nextIndex >= MAX_GROUP_SIZE) {
      throw new RangeError(`group exceeds depth-${MERKLE_DEPTH} capacity`);
    }

    const existingRoot = rebuildExistingRootFromAppend(
      appendWitness.merkleProofLength,
      appendIndex,
      appendWitness.merkleProofSiblings
    );
    if (existingRoot !== currentRoot) {
      throw new Error("append witness does not match the current root");
    }

    return {
      currentRoot,
      nextRoot: rebuildNextRootFromAppend(
        normalized,
        appendWitness.merkleProofLength,
        appendIndex,
        appendWitness.merkleProofSiblings
      ),
      appendIndex: Number(appendIndex),
      appendWitness
    };
  }

  addMember(member) {
    const normalized = normalizeField(member);
    if (normalized === 0n) {
      throw new Error("new commitments must be non-zero");
    }

    if (this._nextIndex >= MAX_GROUP_SIZE) {
      throw new RangeError(`group exceeds depth-${MERKLE_DEPTH} capacity`);
    }

    this._leaves[this._nextIndex] = normalized;
    this._nextIndex += 1;
    this._activeMembers += 1;
    this._recordCurrentRoot();

    return {
      leafIndex: this._nextIndex - 1,
      root: this.root
    };
  }

  updateMember(index, member) {
    const normalized = normalizeField(member);
    if (normalized === 0n) {
      throw new Error("new commitments must be non-zero");
    }

    if (index < 0 || index >= this._nextIndex) {
      throw new RangeError(`member index out of range: ${index}`);
    }

    this._leaves[index] = normalized;
    this._recordCurrentRoot();
    return this.root;
  }

  removeMember(index) {
    if (index < 0 || index >= this._nextIndex) {
      throw new RangeError(`member index out of range: ${index}`);
    }

    if (this._leaves[index] === 0n) {
      throw new Error(`member slot ${index} is already empty`);
    }

    this._leaves[index] = 0n;
    this._activeMembers -= 1;
    this._recordCurrentRoot();
    return this.root;
  }

  _recordCurrentRoot() {
    this._root = computeRoot(this._leaves.slice(0, this._nextIndex));
    this._rootHistory.add(this._root.toString());
  }
}

export function createGroupState(members = []) {
  return new AleoSemaphoreGroup(members);
}
