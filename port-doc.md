# Port Doc

This document is the final v1 implementation specification for the `aleoveil` Semaphore port.

It was revalidated on March 12, 2026 against:
- Semaphore `v4.13.0` semantics and SDK docs
- the root-repo pin in [upstream-source-of-truth.md](/home/usih/go/src/github.com/searchbox-labs/StarkVeil/upstream-source-of-truth.md)
- the current official Aleo language, VM, execution, and fee-model docs

## Final architecture decision

`aleoveil` is a conceptual and semantic port of Semaphore to Aleo.

That means:
- upstream Semaphore `v4.13.0` remains the semantic source of truth for anonymous membership, scoped nullifiers, and one-use-per-scope behavior
- the Aleo implementation uses Aleo's native execution-proof path, not the upstream Circom or Groth16 proving artifacts
- the upstream `.wasm`, `.zkey`, and verification-key JSON files are not runtime artifacts for `aleoveil`
- the legacy local `circuits/semaphore.circom` remains irrelevant to `aleoveil`

The port target is therefore:
- semantic parity with Semaphore at the protocol level
- Aleo-native proving, verification, storage, and submission at the execution level

## Verified implementation constraints

The following constraints are treated as settled and must not be rediscovered during implementation:

1. Aleo proofs are native to the chain. Aleo programs are compiled by `snarkVM`, and execution produces an execution proof that the network verifies.
2. Aleo new-code state updates should use the current async or await model rather than designing a new system around legacy finalize-only patterns.
3. Public persistent state belongs in Aleo mappings. Private witness material belongs in private inputs, not in mappings.
4. Aleo supports sponsored fee models. For anonymous flows, private-sponsored fees are the required fee model.
5. Aleo delegated proving exposes signed plaintext call data to the delegated prover. Therefore delegated proving by an untrusted third party is out of scope for this port.
6. Semaphore scope semantics are fixed: one identity may successfully prove once per scope, and replay in the same scope must resolve to the same nullifier and fail.

## Non-goals

The following are explicitly out of scope for v1:

- direct reuse of upstream Semaphore `.wasm`, `.zkey`, or verification-key JSON files on Aleo
- an Aleo-side Groth16 verifier bridge analogous to StarkVeil's Cairo verifier adapter
- byte compatibility with StarkVeil calldata or Starknet verifier contracts
- support for Merkle depths other than `20`
- batch insertion
- delegated proving by an untrusted prover service
- direct end-user transaction submission for anonymity-preserving flows
- storing raw `message` or raw `scope` in protocol mappings, or storing identity secrets or Merkle siblings in public state

## Normative v1 profile

### Toolchain and network

- Leo version: `3.5.0`
- `snarkVM` version: `4.0.0`
- development network baseline: `testnet`
- canonical program id: `veil_semaphore_v1.aleo`
- canonical proof-validation transition: `validate_proof_depth_20`
- supported Merkle depth: `20` only

### Conceptual Semaphore target

The port preserves the following Semaphore properties:

- group membership is represented by a Merkle root over public identity commitments
- a participant proves knowledge of a private identity secret that opens one committed leaf
- the proof reveals only the intended public values
- the nullifier is scoped, so one identity can act once per scope
- a reused nullifier is rejected

The port does not preserve the following as runtime requirements:

- upstream Circom artifact compatibility
- exact Groth16 proof bytes
- the upstream Semaphore identity-key derivation internals

### Canonical cryptographic profile

The Aleo conceptual port uses an Aleo-native identity and Merkle profile. These formulas are final for v1.

Hashing rule:

```text
typed_psd2([a, b]) =
  Poseidon2(Plaintext::from("[a, b]").toFields())

typed_psd4([a, b, c, d]) =
  Poseidon4(Plaintext::from("[a, b, c, d]").toFields())
```

This is the exact Leo-compatible rule behind `Poseidon2::hash_to_field` and `Poseidon4::hash_to_field` for `[field; N]` arrays in this port. It is not the raw-opcode rule.

Domain constants:

```text
IDENTITY_DOMAIN = 1field
NULLIFIER_DOMAIN = 3field
ROOT_HISTORY_DOMAIN = 4field
MEMBER_SLOT_DOMAIN = 5field
MEMBER_COMMITMENT_DOMAIN = 6field
```

Canonical formulas:

```text
identity_commitment =
  typed_psd4([IDENTITY_DOMAIN, identity_secret, 0field, 0field])

tree_hash(left, right) =
  typed_psd2([left, right])

nullifier =
  typed_psd4([NULLIFIER_DOMAIN, identity_secret, scope_hash, 0field])

root_key(group_id, root) =
  typed_psd4([ROOT_HISTORY_DOMAIN, group_id_as_field, root, 0field])

member_slot_key(group_id, leaf_index) =
  typed_psd4([MEMBER_SLOT_DOMAIN, group_id_as_field, leaf_index_as_field, 0field])

member_commitment_key(group_id, commitment) =
  typed_psd4([MEMBER_COMMITMENT_DOMAIN, group_id_as_field, commitment, 0field])
```

Type rules:

- `identity_secret` is a uniformly random private `field`
- `identity_secret` must never be derived from, equal to, or reused as an Aleo account private key
- `group_id_as_field` is the canonical field conversion of the `u64` group id
- `leaf_index_as_field` is the canonical field conversion of the `u32` leaf index

### Canonical `message` and `scope` preprocessing

`aleoveil` keeps the Semaphore message public. The participant sends the public message to the relayer, and the relayer posts it on-chain as a public execution argument.

Because Leo does not use a native dynamic string type for this port, v1 uses a fixed public message representation and a hashed scope representation.

The canonical preprocessing rule is:

```text
normalize_bytes(number) = 32-byte big-endian encoding of the non-negative integer
normalize_bytes(string) = 32-byte ethers encodeBytes32String encoding

split128(bytes32) = [
  big_endian_u128(bytes32[0..15]),
  big_endian_u128(bytes32[16..31])
]

message = split128(normalize_bytes(message_input))
scope_hash = keccak256(normalize_bytes(scope_input)) >> 8
```

Additional rules:

- numeric values must be non-negative integers
- string values must fit `encodeBytes32String` semantics, so max length is 31 bytes
- `message` is the canonical public Semaphore signal value for v1
- `scope_hash` is the canonical public scope value for nullifier derivation and replay domains
- the relayer must submit the exact public `message` value that the participant authorized and proved over
- applications that need group- or app-specific uniqueness must incorporate that context into `scope_input` before hashing
- `message` remains public, but any Aleo-side message binding must use the Leo-compatible typed `Poseidon2::hash_to_field` rule over `[message[0], message[1]]`

### Canonical Merkle tree model

The final v1 tree model uses padded LeanIMT semantics.

That means:

- the tree hash is `Poseidon2(left, right)`
- the tree hash means Leo-compatible `typed_psd2([left, right])`, not a raw field-array hash
- missing right children do not hash with zero; the parent simply takes the left child value
- the empty tree root is `0field`
- the effective proof depth is dynamic
- the maximum supported proof depth is `20`
- witness arrays are padded to length `20` for Aleo input stability
- capacity is capped at `2^20` leaves through `group_next_index`

Canonical empty-root rule:

```text
EMPTY_ROOT = 0field
```

Witness shape for proof validation:

- `merkle_proof_length: u8`
- `merkle_proof_index: u32`
- `merkle_proof_siblings: [field; 20]`

LeanIMT root recomputation rule:

```text
node = leaf
for i in 0..(merkle_proof_length - 1):
  if bit(merkle_proof_index, i) == 1:
    node = tree_hash(merkle_proof_siblings[i], node)
  else:
    node = tree_hash(node, merkle_proof_siblings[i])

for i in merkle_proof_length..19:
  assert merkle_proof_siblings[i] == 0field
```

LeanIMT append rule for `add_member`:

```text
node = new_commitment
cursor = group_next_index
for each level i from 0 to 19:
  if cursor > 0:
    if cursor is odd:
      node = tree_hash(merkle_proof_siblings[i], node)
    else:
      assert merkle_proof_siblings[i] == 0field
    cursor = cursor >> 1
  else:
    assert merkle_proof_siblings[i] == 0field
count only the odd-level supplied siblings toward merkle_proof_length
remaining padded sibling slots must be 0field
```

Membership-mutation rules:

- `add_member` appends at `group_next_index`
- `add_member` uses a level-aligned padded LeanIMT append witness, not zero-leaf replacement
- `add_member` receives `merkle_proof_index` as the append cursor and it must equal `group_next_index`
- `update_member` proves the old committed leaf with `merkle_proof_length`, `merkle_proof_index`, and siblings
- `remove_member` proves the old committed leaf and replaces it with `0field`
- removed leaves are not reused in v1

### Public and private data model

Public execution inputs for `validate_proof_depth_20`:

- `group_id: u64.public`
- `merkle_root: field.public`
- `nullifier: field.public`
- `message: [field; 2].public`
- `scope_hash: field.public`

Private execution inputs for `validate_proof_depth_20`:

- `identity_secret: field.private`
- `merkle_proof_length: u8.private`
- `merkle_proof_index: u32.private`
- `merkle_proof_siblings: [field; 20].private`

Public state:

- program-admin and initialization status
- group existence
- group admin
- group depth
- group active member count
- group append cursor
- current root
- historical-root validity
- member slot contents
- commitment-active flags
- nullifier-used flags

Private and off-chain only:

- raw `scope`
- `identity_secret`
- Merkle siblings
- participant-side proof witness
- relay authorization signatures

Public but not stored:

- `message`
- `scope_hash`
- `nullifier`
- the public transition arguments included in the execution

### Canonical state model

The v1 program must use the following public mappings:

- `initialized[0u8] -> bool`
- `program_admin[0u8] -> address`
- `group_exists[group_id] -> bool`
- `group_admin[group_id] -> address`
- `group_depth[group_id] -> u8`
- `group_active_members[group_id] -> u32`
- `group_next_index[group_id] -> u32`
- `group_root[group_id] -> field`
- `group_root_valid[root_key(group_id, root)] -> bool`
- `group_member[member_slot_key(group_id, leaf_index)] -> field`
- `group_member_index[member_commitment_key(group_id, commitment)] -> u32`
- `group_commitment_active[member_commitment_key(group_id, commitment)] -> bool`
- `nullifier_used[nullifier] -> bool`

Semantic rules:

- `group_active_members` counts non-zero active leaves
- `group_next_index` is the append cursor and never decreases
- `group_depth[group_id]` is always `20`
- every root ever produced by `create_group`, `add_member`, `update_member`, or `remove_member` remains valid forever
- `validate_proof_depth_20` may accept any historical root for the group
- membership mutations must use the current root only

### Canonical transition surface

The final v1 transition surface is:

1. `initialize(owner: address.public)`
2. `transfer_ownership(new_owner: address.public)`
3. `create_group(group_id: u64.public, admin: address.public)`
4. `set_group_admin(group_id: u64.public, next_admin: address.public)`
5. `add_member(group_id: u64.public, new_commitment: field.public, current_root: field.public, merkle_proof_length: u8.private, merkle_proof_index: u32.private, merkle_proof_siblings: [field; 20].private)`
6. `update_member(group_id: u64.public, leaf_index: u32.public, old_commitment: field.public, new_commitment: field.public, current_root: field.public, merkle_proof_length: u8.private, merkle_proof_index: u32.private, merkle_proof_siblings: [field; 20].private)`
7. `remove_member(group_id: u64.public, leaf_index: u32.public, old_commitment: field.public, current_root: field.public, merkle_proof_length: u8.private, merkle_proof_index: u32.private, merkle_proof_siblings: [field; 20].private)`
8. `validate_proof_depth_20(group_id: u64.public, merkle_root: field.public, nullifier: field.public, message: [field; 2].public, scope_hash: field.public, identity_secret: field.private, merkle_proof_length: u8.private, merkle_proof_index: u32.private, merkle_proof_siblings: [field; 20].private)`
9. `is_supported_depth(depth: u8.public) -> bool`

There is no caller-supplied depth parameter in the proof-validation transition. Depth is fixed by the transition itself.

### Canonical privacy and submission model

The anonymity-preserving flow is final for v1:

1. The participant generates `identity_secret` locally.
2. The participant computes `identity_commitment` locally.
3. The participant builds the Merkle witness locally from public group state.
4. The participant locally proves `validate_proof_depth_20`.
5. The participant sends the public `message`, the proof-backed execution package, and the off-chain relay authorization to the relayer.
6. The relayer or sponsor submits the transaction.
7. The relayer uses private-sponsored fees.

Hard rules:

- direct participant submission is not an anonymity-preserving flow
- relayer-side proving is not allowed in v1
- third-party delegated proving is not allowed in v1
- the participant's Aleo account must not appear as signer, fee payer, or public protocol identity in the anonymous flow
- the relayer must not substitute or mutate the public `message`

The off-chain relay authorization payload is fixed:

- `program_id`
- `function_id`
- `group_id`
- `merkle_root`
- `nullifier`
- `message`
- `scope_hash`
- `deadline`
- `nonce`

The relay authorization remains off-chain and is never verified on-chain against the participant's long-lived Aleo account.

## Ordered implementation points

1. Pin the conceptual-port contract of the project.
   Implement:
   - declare that `aleoveil` is a semantic Semaphore port and not an upstream Groth16 artifact port
   - pin Leo `3.5.0`, `snarkVM` `4.0.0`, testnet, program id `veil_semaphore_v1.aleo`, and depth `20`
   Test:
   - reject any build or manifest change that reintroduces upstream runtime artifact dependence

2. Freeze the manifest around the semantic-port model.
   Implement:
   - record the semantic source pin, toolchain pin, program id, canonical transitions, and the explicit exclusion of upstream `.wasm`, `.zkey`, and VK artifacts from Aleo runtime
   Test:
   - manifest validation fails if runtime source fields point back to Circom or Groth16 artifacts

3. Implement the exact `message` and `scope` normalization module.
   Implement:
   - numeric normalization to 32 bytes
   - `encodeBytes32String` normalization for strings
   - `split128` conversion for public `message`
   - `keccak256(... ) >> 8` field conversion for `scope_hash`
   Test:
   - fixed numbers and fixed strings produce exact public `message` values and exact `scope_hash` values

4. Implement the exact domain-separated cryptographic helpers.
   Implement:
   - `identity_commitment`
   - `tree_hash`
   - `nullifier`
   - `root_key`
   - `member_slot_key`
   - `member_commitment_key`
   Test:
   - each helper matches the formulas in this document exactly

5. Implement the padded LeanIMT root helpers.
   Implement:
   - `EMPTY_ROOT = 0field`
   - padded witness handling through depth `20`
   - level-aligned append siblings for `add_member`
   - `merkle_proof_index` handling for both append and leaf proofs
   Test:
   - an empty group root equals `0field`

6. Implement the fixed v1 transition surface exactly.
   Implement:
   - the nine transitions listed in the canonical transition surface
   - no extra depth-parametrized proof-validation route
   Test:
   - `is_supported_depth(20)` is true
   - every unsupported depth resolves to no valid proof-validation route

7. Implement initialization and ownership.
   Implement:
   - `initialized`
   - `program_admin`
   - `initialize`
   - `transfer_ownership`
   Test:
   - initialize succeeds once
   - reinitialize fails
   - only owner can transfer ownership

8. Implement group creation with the fixed empty root.
   Implement:
   - `create_group`
   - admin assignment
   - depth `20`
   - `group_active_members = 0`
   - `group_next_index = 0`
   - `group_root = 0field`
   - historical-root marking for `0field`
   Test:
   - duplicate group ids fail

9. Implement group-admin rotation.
   Implement:
   - `set_group_admin`
   Test:
   - only current group admin can rotate the admin

10. Implement `add_member` as a padded LeanIMT append.
    Implement:
    - assert `current_root == stored current root`
    - use `group_next_index` as the append cursor
    - require `merkle_proof_index == group_next_index`
    - apply the canonical level-aligned padded LeanIMT append rule
    - reject `new_commitment == 0field`
    - reject existing active commitment
    - update member slot, member index, active flag, active-member count, append cursor, current root, and historical roots
    Test:
    - valid append succeeds
    - wrong root, wrong append index, wrong append witness, duplicate commitment, and full-capacity insertion fail

11. Implement `update_member` as a current-root authenticated replacement.
    Implement:
    - verify witness against `old_commitment` using `merkle_proof_length`, `merkle_proof_index`, and siblings
    - assert `leaf_index` matches the stored index for `old_commitment`
    - reject `new_commitment == 0field`
    - reject unchanged commitment
    - reject already active `new_commitment`
    - update member slot, member index, commitment-active flags, current root, and historical roots
    Test:
    - malformed sibling arrays or wrong old commitment fail

12. Implement `remove_member` as a current-root authenticated zeroing operation.
    Implement:
    - verify witness against `old_commitment` using `merkle_proof_length`, `merkle_proof_index`, and siblings
    - assert `leaf_index` matches the stored index for `old_commitment`
    - write `0field` to the slot
    - clear the old commitment-active flag
    - decrement active-member count
    - keep append cursor unchanged
    - update current root and historical roots
    Test:
    - repeated removals fail

13. Implement lifetime historical-root validity.
    Implement:
    - every root produced by `create_group`, `add_member`, `update_member`, or `remove_member` is marked valid forever
    Test:
    - old roots remain valid after later mutations

14. Implement the canonical mapping query surface.
    Implement:
    - expose all protocol reads through mappings, not through custom event expectations
    Test:
    - mapping reads alone are sufficient to reconstruct protocol state

15. Implement the Aleo-native identity wrapper.
    Implement:
    - local generation of random `identity_secret`
    - local derivation of `identity_commitment`
    - serialization and import or export
    Test:
    - a fixed secret yields a stable commitment
    - the identity secret is distinct from any Aleo account private key

16. Implement the padded LeanIMT tree builder off-chain.
   Implement:
   - empty-root initialization
   - append
   - update
   - remove
   - witness generation over `[field; 20]`
   Test:
    - the off-chain root matches the exact formulas in this document

17. Implement join-by-commitment only.
    Implement:
    - the join path submits only `identity_commitment`
    Test:
    - no secret or Aleo account key material enters the join payload

18. Implement the `validate_proof_depth_20` witness builder.
    Implement:
    - bind `identity_secret`, `merkle_proof_length`, `merkle_proof_index`, and siblings to the group root
    - derive `nullifier` from `identity_secret` and `scope_hash`
    - pass `message` and `scope_hash` as canonical public inputs
    Test:
    - witness objects match the exact function signature and formulas

19. Implement local proof-backed execution generation.
    Implement:
    - generate proof-backed local execution for `validate_proof_depth_20` through the Aleo toolchain
    Test:
    - a valid witness produces a locally valid execution artifact

20. Implement the canonical execution package.
    Implement:
    - include `program_id`, `function_id`, `group_id`, `merkle_root`, `nullifier`, `message`, `scope_hash`, typed public inputs, and execution metadata
    - exclude raw `scope`, `identity_secret`, and Merkle siblings from the public package
    Test:
    - serialization is lossless

21. Implement the canonical relayer authorization package.
    Implement:
    - include exactly the nine payload fields defined above
    - keep it off-chain
    Test:
    - any missing or extra field fails authorization-shape validation

22. Replace all placeholder validation with the native Aleo proof path.
    Implement:
    - no transition may accept proof-shaped inputs without the actual Aleo execution proof path
    Test:
    - valid execution verifies
    - tampered execution fails

23. Implement depth routing as a single fixed route.
    Implement:
    - route all proof-backed actions to `validate_proof_depth_20`
    - reject any attempt to emulate alternate depths
    Test:
    - there is exactly one supported proof-validation route

24. Implement canonical input ordering and visibility.
    Implement:
    - preserve flattened public input order `[merkle_root, nullifier, message[0], message[1], scope_hash]`
    - keep `identity_secret`, `merkle_proof_length`, `merkle_proof_index`, and siblings private
    Test:
    - reordering or changing visibility breaks validation

25. Implement the end-to-end anonymous submission flow.
    Implement:
    - participant local proving
    - participant sends the public `message` to the relayer
    - off-chain relay authorization
    - relayer private-sponsored fee submission
    Test:
    - participant secrets never reach the relayer in plaintext
    - relayer-side `message` substitution fails validation

26. Implement public nullifier status.
    Implement:
    - `nullifier_used`
    Test:
    - unused before success, used after success

27. Implement replay rejection.
    Implement:
    - reject reused nullifiers
    Test:
    - same `identity_secret` and same `scope_hash` fail on second use

28. Implement root-validity and current-root checks.
    Implement:
    - `validate_proof_depth_20` accepts any historical root
    - membership mutation transitions accept current root only
    Test:
    - wrong group, wrong root, or stale current root is rejected where applicable

29. Implement invalid witness and invalid proof rejection.
    Implement:
    - reject wrong siblings
    - reject wrong leaf index
    - reject wrong `nullifier`
    - reject wrong `message` or `scope_hash`
    Test:
    - each tampering class fails independently

30. Implement the deployment and environment profile.
    Implement:
    - one deployed program edition for v1
    - one environment configuration for testnet and local execution
    - mapping-based read and validation paths
    Test:
    - a fresh deployment is queryable and accepts at least one valid proof-backed execution

31. Accept parity only at the semantic level.
    Implement:
    - document the deliberate differences from StarkVeil and upstream Groth16 artifact reuse
    Test:
    - reviewers can verify that every remaining incompatibility is intentional and listed, not accidental
