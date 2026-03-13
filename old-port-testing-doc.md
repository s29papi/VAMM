# Port Testing Doc

This document is a 1:1 testing map for the `Ordered implementation points` in [vibe/port-doc.md](/home/usih/go/src/github.com/searchbox-labs/StarkVeil/vibe/port-doc.md).

Each testing point below corresponds to the implementation point with the same number.

## Testing modes

This document describes the `target` tests for the port, but not every point is equally executable in every environment.

There are two testing modes:

- `Source-level validation`: checks that the intended logic, guards, storage writes, event payloads, interfaces, and helper wiring are actually present in the implementation.
- `Runtime / integration validation`: checks compiled Cairo contracts through real execution, state transitions, reverts, event emission, and end-to-end proof flows.

## Practical prerequisite

Full behavioral testing for the Cairo contract points requires installed Cairo/Starknet tooling, especially:

- `scarb`
- `snforge`

Without that toolchain, some tests can only be executed as source-shape validation and not as true runtime/integration tests.

So for this document:

- the testing points remain the correct `full` target tests
- but if Cairo runtime tooling is unavailable, execution may temporarily fall back to source-level validation
- a point is only fully behavior-tested once the runtime/integration form of the test has been executed

## Reading the points

For each point below:

- `What to test` describes the real intended behavior or invariant
- `How to test` describes the target execution form
- if the environment does not yet support runtime Cairo tests, treat the point as partially executable until the runtime form is run

## Ordered implementation testing points

1. Test upstream version pinning and source-of-truth selection.
   What to test:
   - the chosen upstream Semaphore version is explicitly pinned
   - the referenced circuit source, `.wasm`, `.zkey`, and verification key all belong to that exact version
   - no flow references the legacy local `circuits/semaphore.circom` as the canonical proving source
   How to test:
   - inspect the pinned version declaration and artifact references
   - compare artifact/version metadata across all references
   - search the project for accidental use of the legacy local circuit in the upstream-compatible path
   Pass condition:
   - all upstream references resolve to one exact version and the legacy circuit is not used in the upstream-compatible proving path

2. Test the artifact manifest.
   What to test:
   - the manifest lists all required upstream artifacts
   - expected hashes, locations, and semantics are present
   How to test:
   - run manifest validation against the locally available artifacts
   - intentionally alter one referenced file or hash entry in a test copy and confirm validation fails
   Pass condition:
   - the manifest accepts the correct artifact set and rejects a mismatched one

3. Test the hashing and public-input semantics module.
   What to test:
   - `message_hash` and hashed-scope values are computed as intended
   - verifier public input ordering is correct
   How to test:
   - feed the module fixed test vectors for `message`, `scope`, root, and nullifier
   - compare outputs against known expected values and ordering
   Pass condition:
   - the module deterministically produces the exact expected verifier-facing values

4. Test contract deployment and initialization behavior.
   What to test:
   - constructor sets the owner and initialized state correctly
   - `initialize` cannot be used more than once
   How to test:
   - deploy a fresh contract and read the resulting state
   - call `initialize` in valid and invalid sequences
   Pass condition:
   - initial state is correct and repeated initialization is rejected

5. Test ownership transfer behavior.
   What to test:
   - only the owner can transfer ownership
   - ownership changes persist correctly
   - ownership transfer event is emitted
   How to test:
   - call `transfer_ownership` as owner and non-owner
   - inspect resulting owner state and emitted event data
   Pass condition:
   - authorized transfer succeeds, unauthorized transfer fails, and the event is correct

6. Test verifier-registration behavior.
   What to test:
   - valid-depth verifier registration succeeds
   - invalid-depth registration fails
   - only the owner can register a verifier
   - verifier registration event is emitted
   How to test:
   - call `set_verifier` with valid and invalid depths from owner and non-owner accounts
   - inspect stored verifier mappings and event data
   Pass condition:
   - only valid owner-driven registrations succeed and state/event output is correct

7. Test group creation behavior.
   What to test:
   - a new group is created with the correct admin, depth, size, initial root, and root-history entry
   - duplicate creation fails
   - invalid depths fail
   - group-created event is emitted
   How to test:
   - call `create_group` with valid input
   - read group state through getters
   - repeat with duplicate id and invalid depth
   - inspect event data
   Pass condition:
   - valid creation initializes all expected state, invalid creation attempts are rejected, and the event is correct

8. Test group-admin update behavior.
   What to test:
   - current admin can update the admin
   - non-admin cannot update the admin
   - group-admin-updated event is emitted
   How to test:
   - call `set_group_admin` from admin and non-admin accounts
   - inspect stored admin and event data
   Pass condition:
   - authorized update succeeds, unauthorized update fails, and the event is correct

9. Test member insertion behavior.
   What to test:
   - `add_member` updates leaf state, size, root, and root history
   - `add_members` performs batched insertion correctly
   - insertion beyond capacity fails
   - member-added event is emitted
   How to test:
   - insert one member and then a batch of members into a test group
   - read resulting size, leaf values, root, and root-history presence
   - attempt insertion beyond capacity
   - inspect event data
   Pass condition:
   - all valid insertions update state correctly, capacity violations fail, and events are correct

10. Test member update behavior.
    What to test:
    - valid updates replace the stored leaf and root
    - invalid siblings length fails
    - invalid inclusion data fails
    - member-updated event is emitted
    How to test:
    - create a group, add a member, compute valid siblings, and call `update_member`
    - repeat with malformed siblings length and incorrect inclusion inputs
    - inspect resulting state and event data
    Pass condition:
    - only valid updates succeed and produce the expected state/event output

11. Test member removal behavior.
    What to test:
    - valid removals zero the leaf and update the root
    - removing an already removed member fails
    - invalid inclusion data fails
    - member-removed event is emitted
    How to test:
    - create a group, add a member, compute valid siblings, and call `remove_member`
    - repeat removal and test malformed inputs
    - inspect resulting state and event data
    Pass condition:
    - only valid removals succeed and produce the expected state/event output

12. Test root-history invariants.
    What to test:
    - every create/add/update/remove transition records the expected roots
    - historical-root policy behaves as intended
    How to test:
    - execute each state transition in sequence
    - query `is_root` for old and new roots after every transition
   Pass condition:
   - root history matches the intended policy across all membership state changes

13. Test the group-state read/query surface.
    What to test:
    - `get_root`, `get_depth`, `get_size`, `get_member`, and `is_root` return correct values across state transitions
    How to test:
    - read each getter after create, add, update, and remove operations
    - compare against expected state snapshots
    Pass condition:
    - all getters reflect contract state correctly at each stage

14. Test the off-chain identity wrapper.
    What to test:
    - identity generation is deterministic for a fixed private key/input
    - commitment and secret scalar are accessible in the expected representation
    - import/export preserves the identity if implemented
    How to test:
    - generate identities from fixed and random inputs
    - compare repeated fixed-input outputs
    - round-trip import/export if supported
    Pass condition:
    - identity outputs are stable and consistent with upstream semantics

15. Test the prover-side group-state representation.
    What to test:
    - off-chain group construction mirrors the intended group root behavior
    - known commitments produce a deterministic root
    How to test:
    - build a local group from a fixed commitment set
    - compute the root multiple times
    Pass condition:
    - the same commitment set always produces the same expected root

16. Test group-join integration using identity commitments only.
    What to test:
    - the join path sends only the public commitment
    - successful join results in correct on-chain membership insertion
    How to test:
    - instrument or inspect the join request payload
    - confirm no secret scalar/private key is sent
    - confirm on-chain state reflects the joined commitment
    Pass condition:
    - only the commitment is sent and the contract state updates correctly

17. Test off-chain Merkle proof generation.
    What to test:
    - leaf lookup by identity commitment succeeds for a member
    - generated Merkle witness recomputes the expected root
    How to test:
    - use a known group and known member
    - generate the proof and recompute the root from the witness
    Pass condition:
    - the generated Merkle witness is valid for the expected root

18. Test the circuit witness builder.
    What to test:
    - witness fields map exactly to the upstream circuit interface
    - hashed message and hashed scope semantics are preserved
    How to test:
    - construct a witness from fixed identity, group proof, message, and scope inputs
    - compare the resulting witness object against an expected fixture
    Pass condition:
    - the witness is complete, correctly named, and semantically aligned with the upstream circuit

19. Test off-chain proof generation.
    What to test:
    - proof generation succeeds using the pinned upstream artifacts
    - returned proof package contains a valid root/nullifier pair and proof points
    How to test:
    - run proof generation on a known valid identity/group/message/scope fixture
    - inspect the produced proof object
    Pass condition:
    - a valid proof object is produced with the expected structural fields and coherent public values

20. Test the proof package schema.
    What to test:
    - the canonical proof package includes all required fields
    - serialization and deserialization preserve those fields exactly
    How to test:
    - serialize a valid proof package to the chosen transport format
    - deserialize it back and compare for equality
    Pass condition:
    - no required field is lost, renamed incorrectly, or mutated in transit

21. Test Starknet calldata preparation.
    What to test:
    - calldata matches the `validate_proof(...)` ABI
    - `message_hash` is computed correctly
    - scope handling matches upstream-compatible verifier semantics
    How to test:
    - prepare calldata from a known proof fixture
    - compare each calldata position with the expected ABI layout and verifier-facing values
    Pass condition:
    - produced calldata is ABI-correct and semantically aligned with upstream proof verification

22. Test the real Cairo Groth16 BN254 backend.
    What to test:
    - a valid proof verifies successfully
    - an invalid proof is rejected
    How to test:
    - call the backend directly with a valid proof/public input set
    - call it again with intentionally corrupted proof data
    Pass condition:
    - the backend accepts valid proofs and rejects invalid ones

23. Test adapter and verifier routing integration.
    What to test:
    - `src/groth16_verifier_adapter.cairo` forwards to the correct backend
    - depth-based routing selects the expected verifier
    - unsupported depths fail
    How to test:
    - configure known verifiers for specific depths
    - submit proof validation requests for supported and unsupported depths
    Pass condition:
    - routing behavior is correct and unsupported depths are rejected

24. Test `validate_proof` public-input alignment with upstream semantics.
    What to test:
    - verifier public input order matches upstream
    - scope value fed to verification preserves upstream hashed-scope semantics
    How to test:
    - validate a proof generated from the pinned upstream circuit
    - alter public input order or scope hashing and repeat
    Pass condition:
    - the correct alignment verifies successfully and altered alignment fails

25. Test the full user proof-submission flow.
    What to test:
    - a user/relayer can submit a valid proof package to `validate_proof`
    - successful validation marks the nullifier and emits the proof-validated event
    How to test:
    - submit a valid end-to-end proof package through the normal app/contract boundary
    - inspect transaction result, state changes, and event data
    Pass condition:
    - valid submission succeeds and all expected side effects occur

26. Test the nullifier-status read/query surface.
    What to test:
    - `is_nullifier_used` reports `false` before successful validation
    - `is_nullifier_used` reports `true` after successful validation
    How to test:
    - query before and after one successful proof submission
    Pass condition:
    - nullifier status transitions correctly across validation

27. Test nullifier replay protection.
    What to test:
    - the same nullifier cannot be used twice
    How to test:
    - submit a valid proof once
    - submit the same proof or same nullifier again
    Pass condition:
    - first submission succeeds and second submission fails

28. Test group-root validity and depth-mismatch rejection.
    What to test:
    - invalid roots are rejected
    - wrong depths are rejected
    - historical-root policy matches the intended rule
    How to test:
    - submit proofs or proof-like calls with wrong root, wrong depth, and allowed/disallowed historical roots
    Pass condition:
    - each case is accepted or rejected exactly as intended

29. Test invalid-proof rejection against the real verifier.
    What to test:
    - tampered proof points are rejected
    - mismatched public inputs are rejected
    How to test:
    - modify proof points and submit
    - keep proof constant but alter public inputs and submit
    Pass condition:
    - all tampered or mismatched proof submissions fail

30. Test deployment and environment configuration for supported depths.
    What to test:
    - deployment procedure produces a working environment
    - verifier contracts and keys are correctly mapped to supported depths
    How to test:
    - perform a fresh deployment using the documented deployment flow
    - register at least one working depth and validate a proof for it
    Pass condition:
    - a clean environment can be deployed and used successfully for at least one supported depth

31. Test end-to-end upstream compatibility.
    What to test:
    - the full StarkVeil port accepts proofs generated by the pinned upstream-compatible off-chain flow
    How to test:
    - generate an identity, join a group, generate the proof with the pinned upstream-compatible artifacts, prepare calldata, submit to StarkVeil, and inspect final state
    Pass condition:
    - the contract accepts the proof and records the nullifier while preserving the intended Semaphore semantics
