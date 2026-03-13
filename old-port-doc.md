# Port Doc

This document turns the protocol flow in `vibe/steps.md` into an ordered implementation backlog for the StarkVeil port.

The order matters:

- each point should be implementable and testable on its own
- no point below should depend on a point that comes after it
- later points may depend on earlier points

## Ordered implementation points

1. Pin one exact upstream Semaphore version as the source of truth.
   Implement:
   - choose the upstream Semaphore version to target
   - record the exact circuit source, `.wasm`, `.zkey`, and verification key version
   - document the chosen version and artifact locations in the repo
   Test:
   - confirm every referenced upstream artifact resolves to the same version
   - confirm no local flow is using StarkVeil's legacy `circuits/semaphore.circom` by mistake

2. Add a reproducible artifact manifest for the upstream circuit stack.
   Implement:
   - create a manifest describing the upstream circuit file, proving artifacts, verification key, and expected hashes
   - include the expected public input order and hashing semantics
   Test:
   - verify the manifest can be used to validate the presence and version of every required artifact

3. Implement the upstream-compatible hashing and public-input semantics module.
   Implement:
   - one small module that defines how `message`, `scope`, `message_hash`, nullifier inputs, and verifier public inputs are computed
   - explicitly encode the upstream rule that verification uses `hash(message)` and `hash(scope)`
   Test:
   - given fixed inputs, assert the module outputs the expected verifier-facing values and ordering

4. Implement contract deployment and initialization behavior.
   Implement:
   - constructor-based owner initialization
   - initialized-state handling
   - one-time `initialize` semantics if the contract is used through an initialization flow
   Test:
   - deployment sets the expected owner and initialized state
   - `initialize` cannot be executed more than once

5. Implement ownership transfer behavior.
   Implement:
   - `transfer_ownership`
   - owner authorization checks
   Test:
   - owner can transfer ownership
   - non-owner callers are rejected
   - the expected ownership transfer event is emitted

6. Implement contract verifier-registration behavior.
   Implement:
   - owner-controlled verifier registration with `set_verifier`
   - storage and lookup of verifier contracts by Merkle tree depth
   - invalid-depth rejection for verifier registration
   Test:
   - owner can register a verifier for a valid depth
   - non-owner cannot register a verifier
   - invalid depths are rejected
   - the expected verifier-registration event is emitted

7. Implement group creation behavior.
   Implement:
   - `create_group`
   - storage of group existence, admin, depth, size, initial root, and root history
   Test:
   - a group can be created successfully
   - duplicate group creation fails
   - invalid group depths fail
   - the expected group-created event is emitted

8. Implement group-admin update behavior.
   Implement:
   - `set_group_admin`
   - admin transition and authorization checks
   Test:
   - current admin can change the admin
   - non-admin callers are rejected
   - the expected group-admin-updated event is emitted

9. Implement member insertion behavior.
   Implement:
   - `add_member`
   - `add_members`
   - group size updates, root updates, and capacity checks
   Test:
   - adding a valid member updates the root and size
   - batched insertion works
   - adding past capacity fails
   - the expected member-added event is emitted

10. Implement member update behavior.
   Implement:
   - `update_member`
   - inclusion-proof validation for updates
   - root replacement after update
   Test:
   - updating a valid member changes the root and stored leaf
   - wrong siblings length fails
   - invalid inclusion data fails
   - the expected member-updated event is emitted

11. Implement member removal behavior.
   Implement:
   - `remove_member`
   - inclusion-proof validation for removals
   - zeroing of removed leaves
   Test:
   - removing a valid member changes the root and clears the leaf
   - removing an already removed member fails
   - wrong inclusion data fails
   - the expected member-removed event is emitted

12. Implement root-history invariants for all membership state transitions.
    Implement:
    - root-history updates after group creation, insertion, update, and removal
    - the intended policy for which historical roots remain valid
    Test:
    - each state transition records the expected root values
    - old and new roots are accepted or rejected according to the intended history policy

13. Implement the group-state read/query surface.
    Implement:
    - `get_root`
    - `get_depth`
    - `get_size`
    - `get_member`
    - `is_root`
    Test:
    - each getter returns the expected state after create, add, update, and remove operations

14. Implement the off-chain identity wrapper for the port.
   Implement:
   - user-side identity creation compatible with upstream Semaphore semantics
   - serialization/import-export behavior if needed by the app
   - access to the identity commitment and secret scalar for proof generation
   Test:
   - generate an identity and assert it produces a stable commitment and secret scalar representation

15. Implement the group-state representation used by the prover.
   Implement:
   - a local/off-chain representation of the group tree that mirrors the on-chain group state
   - loading of group members or group tree data into that representation
   Test:
   - build a group from known commitments and assert the resulting root is deterministic

16. Implement group-join integration using identity commitments only.
   Implement:
   - the client/application path that sends only `identity.commitment` for membership insertion
   - the call path for `add_member` or `add_members`
   Test:
   - join a test group with a commitment and assert the contract stores the new root and leaf/member state

17. Implement off-chain Merkle proof generation from the group state.
   Implement:
   - leaf lookup by identity commitment
   - generation of `merkleProofLength`, `merkleProofIndex`, and `merkleProofSiblings`
   Test:
   - for a known group and known member, assert the Merkle proof recomputes the expected root

18. Implement the circuit witness builder.
   Implement:
   - the witness-construction step from identity, Merkle proof, message, and scope
   - explicit mapping to the upstream circuit inputs: `secret`, `merkleProofLength`, `merkleProofIndex`, `merkleProofSiblings`, hashed `message`, and hashed `scope`
   Test:
   - given fixed inputs, assert the witness object is complete and matches the upstream circuit interface exactly

19. Implement off-chain proof generation against the upstream circuit.
   Implement:
   - proof generation using the pinned upstream `.wasm` and `.zkey`
   - extraction of the proof points and public signals
   Test:
   - generate a proof for a known test case and assert a valid proof object is returned with root and nullifier values

20. Implement the proof package schema used by the port.
    Implement:
    - a canonical proof object for the app/relayer/Starknet boundary
    - fields for `merkleTreeDepth`, `merkleTreeRoot`, `nullifier`, `message`, `scope`, and proof points
    Test:
    - serialize and deserialize a generated proof package without losing any required field

21. Implement Starknet calldata preparation from the proof package.
    Implement:
    - translation from the proof package to `validate_proof(...)` calldata
    - correct construction of `message_hash`
    - correct handling of upstream-compatible hashed-scope semantics for verifier-facing inputs
    Test:
    - given a fixed proof package, assert the produced calldata matches the expected ABI layout and verifier public input semantics

22. Replace the Cairo Groth16 backend stub with a real BN254 verifier backend.
    Implement:
    - generate or integrate a real Cairo Groth16 BN254 verifier from the matching upstream verification key
    - remove the current placeholder behavior that always returns `true`
    Test:
    - a valid proof verifies successfully
    - an invalid proof fails verification

23. Wire the real verifier backend through the adapter and contract routing layer.
    Implement:
    - connect the verifier backend to `src/groth16_verifier_adapter.cairo`
    - register verifiers by supported Merkle tree depth through `set_verifier`
    Test:
    - for a configured depth, `validate_proof` reaches the correct verifier path
    - for an unsupported depth, the contract fails as expected

24. Align `validate_proof` public-input handling with upstream verification semantics.
    Implement:
    - ensure the Cairo side verifies against the exact upstream public input order
    - ensure the value supplied for scope at verifier time matches upstream hashed-scope expectations
    Test:
    - a proof generated from the pinned upstream circuit verifies successfully through the Cairo contract
    - the same proof fails if the public input ordering or hashing is intentionally altered

25. Implement the full user proof-submission flow.
    Implement:
    - client or relayer submission of proof packages to `validate_proof`
    - return handling for successful and failed verification
    - success-path finalization including nullifier marking and proof-validated event emission
    Test:
    - submit a valid proof end to end and confirm successful contract validation
    - the expected proof-validated event is emitted

26. Implement the nullifier-status read/query surface.
    Implement:
    - `is_nullifier_used`
    Test:
    - returns `false` before successful proof validation
    - returns `true` after successful proof validation

27. Implement nullifier replay protection tests at the contract boundary.
    Implement:
    - end-to-end handling of one-time signaling per identity per scope
    Test:
    - first submission with a nullifier succeeds
    - second submission with the same nullifier fails

28. Implement group-root validity and depth-mismatch tests at the contract boundary.
    Implement:
    - tests for root history checks and depth-specific verifier routing
    Test:
    - wrong root fails
    - wrong depth fails
    - valid historic or current root behavior matches the intended policy

29. Implement invalid-proof rejection tests against the real verifier.
    Implement:
    - tests that tampered proof points or tampered public inputs are rejected
    Test:
    - corrupted proof fails
    - mismatched public inputs fail

30. Implement deployment and environment configuration for supported depths.
    Implement:
    - deployment procedure for backend, adapter, and contract instances
    - mapping from supported tree depths to verifier contracts and verification keys
    Test:
    - a fresh deployment can register at least one working depth and validate proofs for that depth

31. Implement a final end-to-end compatibility test against the pinned upstream stack.
    Implement:
    - a full integration test from identity generation to Starknet verification using the chosen upstream version
    Test:
    - generate a proof with the upstream-compatible off-chain flow
    - submit it to StarkVeil
    - verify that the contract accepts it and records the nullifier

## Practical reading

Points `1` through `13` complete the core contract lifecycle, state-transition surface, and contract query surface.

Points `14` through `21` complete the off-chain proving side and the app-to-contract boundary.

Points `22` through `24` complete the Cairo verification side.

Points `25` through `31` complete the user-facing flow, readback checks, deployment, and end-to-end correctness validation.
