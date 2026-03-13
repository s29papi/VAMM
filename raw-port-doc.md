# Aleo Raw Port Doc

Derived on March 12, 2026 by checking [port-doc.md](/home/usih/go/src/github.com/searchbox-labs/StarkVeil/port-doc.md) and [port-testing-doc.md](/home/usih/go/src/github.com/searchbox-labs/StarkVeil/port-testing-doc.md) against the latest official Aleo language and cryptography material.

Primary sources used:
- <https://developer.aleo.org/guides/aleo/language/>
- <https://developer.aleo.org/guides/aleo/aleo>
- <https://developer.aleo.org/guides/aleo/installation/>
- <https://developer.aleo.org/specs/aleovm.pdf>
- <https://developer.aleo.org/concepts/network/snarkvm/>
- <https://developer.aleo.org/sdk/wasm/private_key/>
- <https://developer.aleo.org/sdk/wasm/view_key/>
- <https://developer.aleo.org/sdk/wasm/verifying_key/>

Translation rules used for this raw doc:
- Aleo programs use `functions`, `finalize`, `mappings`, `records`, and typed public/private inputs instead of Starknet contract constructors, ABI calldata, and external verifier contracts.
- Aleo deployment transactions already bind each program function to proving and verifying keys, so several Starknet verifier-registry points translate into deployment, function-shape, and program-edition concerns instead.
- I did not find an event-emission primitive in the cited Aleo language or VM sources, so any original event assertions should be translated into mapping-state checks plus transaction or transition inspection. This is an inference from the current docs, not a direct quoted rule.

## Ordered Aleo-native implementation points

1. Pin one exact Aleo toolchain and protocol baseline as the source of truth. The StarkVeil point about pinning one Semaphore version carries over as pinning one Leo CLI version, one `snarkVM` version, one Aleo network target, and one program edition policy. The acceptance check is that every local build, proving path, and deployment path resolves to that exact Aleo stack and no unpinned Leo or `snarkVM` version is used.

2. Add a reproducible Aleo artifact manifest. Instead of `.wasm`, `.zkey`, and a separate verifier contract, the manifest should record the Aleo or Leo source, compiled `.aleo` output if Leo is used, deployment transaction id, function ids, and proving or verifying key checksums per function. The acceptance check is that the manifest can prove which deployed program edition and function keys the app is using.

3. Implement one small hashing and typed-input semantics module. This still maps directly from the original hashing point, but on Aleo it should define exact input encoding into Aleo `field`, `scalar`, or other supported types and select the supported hash opcode family such as `hash.bhp*`, `hash.ped*`, or `hash.psd*`. The acceptance check is deterministic output for fixed `message`, `scope`, nullifier seed, identity secret, and Merkle inputs, without any manual Starknet-style verifier public-input array handling.

4. Replace constructor-style initialization with Aleo deployment plus one-time mapping initialization. Aleo uses deployed programs and `finalize` blocks for persistent public state, so the equivalent of deployment and initialization is an `initialize` function guarded by an `initialized` mapping or equivalent public flag. The acceptance check is that a fresh deployment can initialize once and any second initialization attempt fails.

5. Implement ownership or admin transfer as public program state. The Starknet ownership point carries over by storing the owner or admin address in a public mapping and enforcing authorization through function logic, typically around `self.caller` and `self.signer` semantics. The acceptance check is that only the current owner can update ownership and the stored owner value changes exactly once per valid call.

6. Replace verifier-registration-by-depth with function or program selection by supported depth. Aleo already binds verifying keys to functions at deployment time, so there is no direct analog to `set_verifier` as a mutable registry unless the app adds an extra config mapping on purpose. The closest Aleo-native resolution is to choose either one function per supported tree depth or one fixed-depth function with a single canonical depth policy; this is an inference from the current VM and SDK model.

7. Implement group creation with public mappings. This maps cleanly: store `group_exists`, `group_admin`, `group_depth`, `group_size`, `current_root`, and root-history metadata in Aleo mappings that are updated only in `finalize`. The acceptance check is that group creation writes all expected mapping entries and rejects duplicate ids or unsupported depths.

8. Implement group-admin updates against the public group mappings. This point stays almost unchanged, except the state change happens through an Aleo transition and `finalize` rather than a contract method mutating storage directly. The acceptance check is that the current admin can rotate admin state and non-admin callers are rejected.

9. Implement member insertion as a proof-backed state transition. Because Aleo programs execute in zero knowledge and public mappings are updated in `finalize`, `add_member` should take the insertion inputs needed to recompute the new Merkle root and then commit the new root and size publicly. The acceptance check is that valid insertions update `size`, `current_root`, and member leaf state while insertions past capacity fail.

10. Implement member updates as a proof-backed state transition over a known root. This maps directly, but the Aleo function should consume the old leaf, new leaf, and path witness as typed inputs and prove the root replacement before `finalize` writes the new public root. The acceptance check is that malformed sibling data or bad inclusion data fails before state is updated.

11. Implement member removal as a proof-backed state transition over a known root. The Aleo-native version should zero or tombstone the target leaf according to the app's chosen tree semantics and then commit the resulting root in `finalize`. The acceptance check is that removing a valid member changes the root and invalid or repeated removals fail.

12. Implement root-history invariants in mappings. The StarkVeil root-history point carries over directly because Aleo mappings are the natural public store for current and historical roots. The acceptance check is that every create, add, update, and remove transition writes the intended history entries and that any "historical root still valid" policy is encoded explicitly rather than implied.

13. Implement the public group query surface as mapping reads. Aleo mappings are public on-chain state, so the equivalent of `get_root`, `get_depth`, `get_size`, `get_member`, and `is_root` is either direct mapping inspection by clients or thin helper functions if the app wants a stable query interface. The acceptance check is that the public mapping layout is sufficient to reconstruct group state after every transition.

14. Implement a protocol identity wrapper that is separate from the Aleo account key unless intentionally unified. The original off-chain identity point does not map to Aleo `PrivateKey` directly, because Aleo account keys are account, signing, and record-decryption primitives, not automatically a Semaphore-style membership identity. The Aleo-native resolution is to define an app identity secret and commitment scheme using Aleo-supported field or scalar types and hashes, while using Aleo account keys only for transaction authorization unless the protocol is deliberately redesigned.

15. Implement a prover-side group representation that mirrors the public mappings. This point carries over almost unchanged: keep an off-chain tree representation that can reconstruct the same root the Aleo program expects from its public state. The acceptance check is that the same commitment set always reproduces the same root as the value stored in the program mappings.

16. Implement group join using commitment-only membership payloads. This still applies on Aleo and should remain a hard rule: the join flow should submit only the public commitment and any required public metadata, never the identity secret or any Aleo account private key material. The acceptance check is that the transaction inputs and stored mapping values reveal only the commitment-side data the protocol intends to make public.

17. Implement off-chain Merkle witness generation from the Aleo-visible group state. This point carries over directly because the proving side still needs index and sibling data to prove membership transitions or proof validation. The acceptance check is that a witness generated from public group state recomputes the same root currently recognized by the program.

18. Implement a witness-builder for Aleo execution inputs, not for external Groth16 calldata. The original witness-builder point remains necessary, but the output should be the exact typed input list expected by the Aleo function signature and any imported helper programs. The acceptance check is that the built input vector matches the deployed Aleo function's declared input order and types exactly.

19. Implement off-chain proof generation through Aleo execution. On Aleo, proving is the native execution path provided by `snarkVM`, and the Aleo VM and SDK model treat proof generation as part of function execution and execution-transaction construction. The acceptance check is that a known valid witness produces a valid Aleo execution or execution transaction rather than a standalone Starknet-oriented Groth16 proof package.

20. Replace the Starknet proof package schema with an Aleo execution package schema. The closest Aleo analog is a canonical app-side object containing program id, function id, typed inputs, expected root and nullifier, execution transcript or transaction id, and any pinned verifying-key checksum or program edition metadata. The acceptance check is that the package can be serialized and deserialized without losing the data required to reproduce or verify the Aleo execution.

21. Replace Starknet calldata preparation with Aleo execution-request preparation. There is no `validate_proof(...)` ABI layer here; instead the client prepares typed function inputs and, if needed, an authorization or execution transaction for the selected Aleo program function. The acceptance check is that every input is encoded with the correct Aleo type and in the exact function-signature order.

22. Replace the custom Groth16 backend task with real Aleo-native verification. Aleo execution verification is already part of the network and VM design, and deployment binds proving and verifying keys to functions, so there is no direct analog to a Cairo BN254 verifier adapter. The closest Aleo requirement is to remove any placeholder local validation logic and verify against the actual Aleo execution proof path or deployment-bound verifying keys.

23. Replace adapter and verifier routing with function routing and program-edition routing. If multiple depths or protocol variants must be supported, the Aleo-native choices are separate functions, separate program editions, or an explicit dispatch layer in the app. The acceptance check is that the client always selects the function whose signature, depth policy, and deployed keys match the witness being proved.

24. Align all public and private input handling with the deployed Aleo function signature. This is the Aleo analog of matching verifier public-input order: the order, type, visibility, and hash preprocessing of every function input must match the deployed program exactly. The acceptance check is that a valid execution succeeds with the canonical ordering and fails if input ordering, visibility, or hashing is intentionally perturbed.

25. Implement the full user proof-submission flow as Aleo program execution plus public-state update. The user or relayer equivalent should execute the Aleo function, submit the resulting execution transaction, and then observe the expected public mapping updates such as nullifier usage, group root changes, or membership changes. The acceptance check is end-to-end success on a live or test Aleo environment with the expected public state after confirmation.

26. Implement nullifier-status public state and query behavior. This maps directly by storing nullifier usage in a public mapping keyed by the nullifier representation chosen in point 3. The acceptance check is that the mapping is false or absent before a successful proof flow and true immediately after a successful acceptance path.

27. Implement replay protection as a nullifier mapping guard. This is unchanged in spirit: before accepting a proof-backed action, the Aleo program must check whether the nullifier key is already present or already marked used and reject if so. The acceptance check is that the first valid use succeeds and any second use of the same nullifier fails.

28. Implement current-root, historical-root, and depth checks inside the Aleo program logic. This point carries over directly, except the checks should be expressed as typed inputs, mapping reads, and proof-verified root recomputation rather than Starknet contract conditionals over external proof fields. The acceptance check is that wrong roots, wrong depths, and disallowed historical roots are all rejected.

29. Implement invalid-proof rejection against the real Aleo execution path. The Aleo-native meaning is that tampered witnesses, altered typed inputs, or mismatched execution transcripts fail either local verification against the pinned keys or network acceptance. The acceptance check is that proof tampering is rejected without any custom verifier contract layer.

30. Implement deployment and environment configuration for supported depths and editions. Because Aleo deployments carry program code and function keys together, supported depth configuration should live in deployment planning and app config, not in a mutable on-chain verifier registry unless the design intentionally adds one. The acceptance check is that a fresh environment can deploy the intended program edition and execute at least one supported depth successfully.

31. Implement end-to-end protocol parity on Aleo. The final Aleo resolution of the original upstream-compatibility point is not byte-for-byte proof compatibility with Starknet calldata, but semantic parity for the protocol: create identity, join group, derive witness, execute the Aleo program, and confirm root and nullifier behavior match the intended anonymous-membership rules. Where exact StarkVeil or Semaphore proof artifacts cannot carry over unchanged, that incompatibility should be treated as an expected architecture difference, not a bug.

## Conceptual guarantee assessment

This section answers a narrower question than the implementation backlog: if this design is completed in an Aleo-native way, do we still get the intended Semaphore guarantees at the concept level, and do we avoid unintended data leakage.

### Guarantees that can carry over

1. Anonymous membership proofs can carry over. Semaphore's core claim is that a user can prove group membership and send a signal without revealing identity. Aleo supports private inputs and proof-backed execution, so the same high-level property is available if the membership witness, identity secret, and Merkle path remain private inputs and only the intended public outputs are exposed.

2. Membership soundness can carry over. Semaphore requires that only real group members can generate valid proofs. Aleo can enforce the same concept if the program proves inclusion against a recognized group root and updates public state only after successful proof-backed execution.

3. Nullifier-based replay protection can carry over. Semaphore's anti-double-signal guarantee is conceptually preserved if the Aleo design derives one nullifier per identity and scope and stores used nullifiers in a public mapping before accepting the action.

4. Scope separation can carry over. Semaphore uses the external nullifier or scope so the same identity can signal once per context without becoming globally linkable across all contexts. Aleo can preserve this only if the nullifier derivation includes the scope exactly and the stored nullifier is scoped rather than globally identity-derived.

5. Zero-knowledge of witness data can carry over. Aleo private inputs let the system prove correctness without revealing the identity secret, Merkle siblings, or other private witness material.

### Guarantees that do not automatically carry over

1. Sender anonymity does not automatically carry over. Semaphore's proof does not reveal the member identity, but on Aleo the transaction layer still has an executing account and transaction metadata. Current Aleo docs show that transactions are queryable by address and that sender information can be parsed from some transaction outputs. Therefore, if the same user account both signs or funds the execution and acts as the anonymous protocol participant, the account may become linkable to the anonymous action.

2. Message confidentiality does not automatically carry over. Semaphore hides identity, not necessarily the signal itself. If the Aleo program stores the message, scope, or commitment metadata in public mappings or public inputs, that data is intentionally public. Only values passed as private inputs or encrypted records remain hidden.

3. Membership privacy does not automatically carry over. Semaphore groups usually expose the set of public identity commitments, so group membership can still be publicly enumerable at the commitment level. Aleo public mappings have the same property. This is not a break of Semaphore, but it means "no data leak" cannot mean "the membership list is secret" if commitments are stored publicly.

### Data-leak conditions that must be avoided

1. Do not use the Aleo account private key as the Semaphore-style identity secret. If the account key is reused as the protocol identity, anonymous actions become structurally tied to the user's transaction account, which weakens unlinkability.

2. Do not expose `self.signer`, caller address, fee-payer identity, or account-derived values as protocol-level public outputs unless a relayer model is intentionally used. Conceptually, the proof can stay zero-knowledge while the transaction metadata still deanonymizes the user.

3. Do not store secret scalars, witness fragments, Merkle siblings, or raw identity material in mappings. Mappings are public on Aleo and should contain only values that are intended to be public, such as commitments, roots, nullifiers, and admin configuration.

4. Do not let the nullifier be derived from identity alone. It must be scope-bound, otherwise all actions by the same identity become linkable across contexts.

5. Do not place sensitive protocol data in public inputs when a private input or record would suffice. Aleo `.public` values are revealed by design.

### Anonymity-preserving submission model

The intended Aleo-safe submission model is:

1. The user creates the Semaphore-style witness and proof material off-chain.

2. The user may sign an off-chain intent or relay authorization for a coordinator, but that user signature must remain off-chain and must not become part of the public on-chain verification surface.

3. A separate relayer, sponsor, or delegated submitter signs and submits the Aleo transaction that carries the proof-backed program execution.

4. The on-chain program should verify only the protocol proof conditions it actually needs, such as membership, root validity, scope, and nullifier uniqueness, without requiring a public check against the user's long-lived Aleo account.

Conceptually, this preserves Semaphore-style anonymity at the protocol layer while avoiding direct submitter linkability from the participant's own Aleo account.

### Bottom-line conclusion

At the concept level, the Aleo design can preserve the intended Semaphore guarantees for membership soundness, anonymous membership proving, scoped nullifier replay protection, and zero-knowledge witness hiding.

At the concept level, the Aleo design does not automatically guarantee "no data leak" unless the protocol explicitly separates the app identity from the Aleo account, keeps all witness material private, avoids public exposure of signer-linked metadata, and accepts that commitments, roots, nullifiers, program id, function name, and some transaction metadata remain public by design.

So the correct answer is: yes for the core Semaphore security model, but only partially for anonymity unless the execution-submission path is designed to avoid account-level linkability, likely through an explicit relayer or delegated-submission pattern.
