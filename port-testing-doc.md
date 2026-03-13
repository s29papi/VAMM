# Port Testing Doc

This document is the final validation plan for the `aleoveil` conceptual Semaphore port.

It is a 1:1 testing map for the final v1 specification in [port-doc.md](/home/usih/go/src/github.com/searchbox-labs/aleoveil/port-doc.md). Nothing in this document is provisional.

## Fixed validation baseline

The validation environment is fixed for v1:

- Leo `3.5.0`
- `snarkVM` `4.0.0`
- depth `20`
- program id `veil_semaphore_v1.aleo`
- canonical proof-validation transition `validate_proof_depth_20`
- local devnet as the required network-state validation environment
- testnet as the optional promotion environment after devnet succeeds
- local proof-backed validation through `snarkvm execute --offline`
- local no-proof smoke validation through `leo run --offline`

The validation model is also fixed:

- no upstream `.wasm`, `.zkey`, or VK artifact may appear in any `aleoveil` runtime test
- no delegated proving service may appear in any anonymity-preserving test flow
- no direct participant-submitted fee payment may appear in any anonymity-preserving test flow
- all Poseidon expectations must be derived from Leo-compatible typed Aleo plaintext-array hashing, not raw field-array hashing

## Deterministic fixture set

The following fixtures are canonical for v1 tests and must be copied exactly into the implementation test harness.

```json
{
  "domains": {
    "IDENTITY_DOMAIN": "1",
    "NULLIFIER_DOMAIN": "3",
    "ROOT_HISTORY_DOMAIN": "4",
    "MEMBER_SLOT_DOMAIN": "5",
    "MEMBER_COMMITMENT_DOMAIN": "6"
  },
  "empty_root": "0",
  "identity_secret_a": "123456789",
  "identity_secret_b": "987654321",
  "identity_commitment_a": "1182948304507032698537465050160367462347414487992434508883875935309442718716",
  "identity_commitment_b": "8234750101109734748827919178812691912218383913237553979953716845084413691751",
  "message_vote_yes": [
    "157427609233572766078085115461654020096",
    "0"
  ],
  "scope_hash_group7_proposal1": "140525827936694057306769467387521722828804408495893144429793788710514131223",
  "nullifier_a": "5467311534518687774040800679906186926947525492196514789611114859181589301563",
  "root_after_member_a": "1182948304507032698537465050160367462347414487992434508883875935309442718716",
  "root_after_member_b": "3626533395025122996842936469063823917757177181542543229728401745759412977835",
  "proof_length_a": "0",
  "proof_index_a": "0",
  "proof_siblings_a_padded": [
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0"
  ],
  "proof_length_b": "1",
  "proof_index_b": "1",
  "proof_siblings_b_padded": [
    "1182948304507032698537465050160367462347414487992434508883875935309442718716",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0"
  ]
}
```

Required interpretations:

- `root_after_member_a` is the LeanIMT root after adding `identity_commitment_a` as the first member
- `root_after_member_b` is the LeanIMT root after adding `identity_commitment_b` after member A is already present
- `message_vote_yes` is the canonical two-field public message encoding for the string `vote:yes`
- `nullifier_a` is the scoped nullifier for `identity_secret_a` and `scope_hash_group7_proposal1`
- all four Poseidon-derived values above use Leo-compatible typed array hashing through Aleo plaintext serialization

## Validation stages

Every implementation must pass all four stages.

1. Specification and unit stage.
   This validates formulas, fixtures, manifests, payload shapes, and serialization.

2. Local runtime stage.
   This validates the compiled Leo program with `leo run --offline`.

3. Local proof stage.
   This validates proof-backed local execution with `snarkvm execute --offline`.

4. Network state stage.
   This validates deployed mapping writes, nullifier state, and historical roots on a local devnet.

No point is considered complete until it has passed the highest stage relevant to that point.

## Ordered implementation testing points

1. Validate the project classification and version pinning.
   What to test:
   - the docs, manifest, and code classify `aleoveil` as a semantic Aleo-native port
   - Leo is pinned to `3.5.0`
   - `snarkVM` is pinned to `4.0.0`
   - depth is pinned to `20`
   Pass condition:
   - no runtime path references upstream Groth16 artifacts

2. Validate the manifest model.
   What to test:
   - runtime artifact fields point to the Aleo program and local Aleo outputs
   - semantic source fields point to Semaphore `v4.13.0`
   - exclusion of upstream `.wasm`, `.zkey`, and VK artifacts from runtime is explicit
   Pass condition:
   - a tampered manifest that reintroduces upstream runtime artifacts fails validation

3. Validate `message` and `scope` preprocessing.
   What to test:
   - numeric normalization
   - string normalization
   - exact `split128` public-message outputs
   - exact `keccak256(... ) >> 8` scope outputs
   Required fixture checks:
   - `message = "vote:yes"` produces `["157427609233572766078085115461654020096", "0"]`
   - `scope = "proposal:1:group:7"` produces `140525827936694057306769467387521722828804408495893144429793788710514131223`

4. Validate the domain-separated cryptographic helpers.
   What to test:
   - `identity_commitment`
   - `tree_hash`
   - `nullifier`
   - composite-key hashing
   Required fixture checks:
   - `identity_secret_a` maps to `identity_commitment_a`
   - `identity_secret_a` and `scope_hash_group7_proposal1` map to `nullifier_a`

5. Validate zero-root derivation.
   What to test:
   - the empty LeanIMT root is exactly `0field`
   Pass condition:
   - the derived empty root equals `empty_root`

6. Validate the fixed transition surface.
   What to test:
   - the program exports exactly the fixed v1 transitions
   - `validate_proof_depth_20` has no caller-supplied depth parameter
   Local runtime checks:
   - `leo run --offline is_supported_depth 20u8` succeeds with `true`
   - unsupported depth routing fails

7. Validate initialization and ownership.
   What to test:
   - initialize once
   - reject reinitialize
   - owner-only transfer
   Pass condition:
   - public state reflects the new `program_admin` after transfer

8. Validate `create_group`.
   What to test:
   - `group_root == 0field`
   - `group_active_members == 0`
   - `group_next_index == 0`
   - depth is `20`
   - historical-root validity includes `0field`
   Negative cases:
   - duplicate group id fails

9. Validate `set_group_admin`.
   What to test:
   - current admin can rotate admin
   - non-admin cannot
   Pass condition:
   - mapping state shows the new admin only after an authorized call

10. Validate `add_member`.
    What to test:
    - append uses the canonical level-aligned padded LeanIMT append rule
    - the append witness uses `merkle_proof_length`, `merkle_proof_index`, and padded siblings
    - `group_next_index` increments by one
    - `group_active_members` increments by one
    - `group_root` changes and is added to historical-root validity
    Required fixture checks:
    - add `identity_commitment_a` using `proof_length_a`, `proof_index_a`, and `proof_siblings_a_padded`
    - resulting root equals `root_after_member_a`
    Negative cases:
    - wrong append index
    - wrong append siblings

11. Validate `update_member`.
    What to test:
    - witness must prove the old commitment
    - new commitment must be non-zero and not already active
    - old commitment-active flag is cleared
    - new commitment-active flag is set
    Negative cases:
    - unchanged commitment
    - wrong old commitment
    - wrong siblings

12. Validate `remove_member`.
    What to test:
    - witness must prove the old commitment
    - slot is zeroed
    - old commitment-active flag is cleared
    - `group_active_members` decrements
    - `group_next_index` does not change
    Negative cases:
    - repeated remove
    - wrong witness

13. Validate historical-root permanence.
   What to test:
    - every produced root remains valid after later mutations
   Pass condition:
    - `empty_root`, `root_after_member_a`, and any later roots remain queryable as valid

14. Validate the mapping query surface.
    What to test:
    - group existence
    - group admin
    - depth
    - active-member count
    - append cursor
    - current root
    - member slots
    - commitment-active flags
    - nullifier status
    Pass condition:
    - no event-based assumption is required to reconstruct protocol state

15. Validate the identity wrapper.
    What to test:
    - deterministic commitment from a fixed secret
    - random-secret generation for non-fixture identities
    - import and export
    - separation from Aleo account keys
    Pass condition:
    - fixture secret A always maps to fixture commitment A

16. Validate the off-chain padded LeanIMT tree implementation.
    What to test:
    - LeanIMT root derivation
    - append
    - update
    - remove
    - leaf-proof extraction
    - level-aligned append-witness extraction
    - sibling padding to length `20`
    Required fixture checks:
    - adding fixture A yields `root_after_member_a`
    - adding fixture B after A yields `root_after_member_b`

17. Validate join-by-commitment payloads.
    What to test:
    - join payload includes only `group_id` and `identity_commitment`
    Negative cases:
    - any inclusion of `identity_secret`, Merkle siblings, or account key material fails the test

18. Validate the proof witness builder.
    What to test:
    - public inputs are `group_id`, `merkle_root`, `nullifier`, `message`, `scope_hash`
    - private inputs are `identity_secret`, `merkle_proof_length`, `merkle_proof_index`, `siblings`
    - `nullifier` is derived from `identity_secret` and `scope_hash`
    Required fixture checks:
    - `message = "vote:yes"` is represented exactly by `message_vote_yes`
    - fixture A over `root_after_member_a` yields `nullifier_a` for fixture scope hash

19. Validate local proof-backed execution generation.
    What to test:
    - a valid witness can be passed through the local Aleo proof path
    Required tool:
    - `snarkvm execute --offline`
    Pass condition:
    - the local execution artifact is produced without placeholder bypasses

20. Validate execution package shape.
    What to test:
    - package contains `program_id`, `function_id`, `group_id`, `merkle_root`, `nullifier`, `message`, `scope_hash`, typed public inputs, and execution metadata
    - private witness fields are excluded
    Pass condition:
    - round-trip serialization is lossless

21. Validate relay authorization shape.
    What to test:
    - exact field list is `program_id`, `function_id`, `group_id`, `merkle_root`, `nullifier`, `message`, `scope_hash`, `deadline`, `nonce`
    - no extra public signer leakage
    Pass condition:
    - any missing or extra field fails schema validation

22. Validate native Aleo proof verification.
    What to test:
    - the implementation uses the real Aleo proof path
    Negative cases:
    - disabling proof generation
    - bypassing witness validation
    Pass condition:
    - both fail the suite

23. Validate fixed-route depth enforcement.
    What to test:
    - there is one proof-validation route only
    Negative cases:
    - attempts to emulate alternate depths fail

24. Validate public input ordering and visibility.
    What to test:
    - flattened public tuple order is exactly `[merkle_root, nullifier, message[0], message[1], scope_hash]`
    - `identity_secret`, `merkle_proof_length`, `merkle_proof_index`, and siblings remain private
    Negative cases:
    - reorder one public value
    - change one private value to public
    Pass condition:
    - both altered variants fail

25. Validate the anonymous submission model.
    What to test:
    - participant proves locally
    - relayer receives the public `message`, the proof-backed execution package, and off-chain authorization
    - relayer uses private-sponsored fees
    Negative cases:
    - participant direct submission
    - public-sponsored fee flow
    - relayer-side proving
    - relayer-side `message` substitution
    Pass condition:
    - all four are rejected by the test plan as non-compliant

26. Validate nullifier-status reads.
    What to test:
    - unused before successful validation
    - used after successful validation
    Pass condition:
    - mapping query returns the expected boolean before and after execution

27. Validate replay rejection.
    What to test:
    - same identity and same scope cannot validate twice
    Required fixture check:
    - fixture A and fixture scope hash succeed once and fail on second submission

28. Validate root acceptance rules.
    What to test:
    - `validate_proof_depth_20` accepts valid historical roots for the same group
    - membership mutation transitions accept only current root
    Negative cases:
    - root from another group
    - unknown root
    - stale current root for membership mutation

29. Validate invalid witness and proof rejection.
    What to test:
    - wrong siblings
    - wrong leaf index
    - wrong `nullifier`
    - wrong `message`
    - wrong `scope_hash`
    Pass condition:
    - each tampering class fails independently

30. Validate deployment and environment profile.
    What to test:
    - the deployed program exposes the expected mappings
    - local `leo run --offline` smoke checks pass
    - local `snarkvm execute --offline` proof-backed checks pass
    - testnet mapping reads reflect a successful execution
    Pass condition:
    - all three stages pass against the same program edition

31. Validate semantic parity and deliberate divergence.
    What to test:
    - the implementation preserves anonymous membership, scoped nullifier replay protection, and historical-root acceptance
    - the implementation deliberately diverges from upstream in the documented places only
    Required review output:
    - one explicit checklist that states:
      - no upstream Groth16 runtime artifact reuse
      - LeanIMT semantics are preserved with padded witnesses
      - public message is relayed and posted on-chain as transition data
      - no delegated proving
      - no direct user-account submission for anonymous flows
      - no mapping storage of raw `scope` or witness data
