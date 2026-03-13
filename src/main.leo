// The 'veil_semaphore_v1' program.
program veil_semaphore_v1.aleo {
    const MERKLE_DEPTH: u8 = 20u8;
    const MAX_GROUP_SIZE: u32 = 1048576u32;

    const IDENTITY_DOMAIN: field = 1field;
    const NULLIFIER_DOMAIN: field = 3field;
    const ROOT_HISTORY_DOMAIN: field = 4field;
    const MEMBER_SLOT_DOMAIN: field = 5field;
    const MEMBER_COMMITMENT_DOMAIN: field = 6field;

    mapping initialized: u8 => bool;
    mapping program_admin: u8 => address;

    mapping group_exists: u64 => bool;
    mapping group_admin: u64 => address;
    mapping group_depth: u64 => u8;
    mapping group_active_members: u64 => u32;
    mapping group_next_index: u64 => u32;
    mapping group_root: u64 => field;

    mapping group_root_valid: field => bool;
    mapping group_member: field => field;
    mapping group_member_index: field => u32;
    mapping group_commitment_active: field => bool;
    mapping nullifier_used: field => bool;

    @noupgrade
    async constructor() {}

    inline tree_hash(left: field, right: field) -> field {
        let inputs: [field; 2] = [left, right];
        return Poseidon2::hash_to_field(inputs);
    }

    inline derive_identity_commitment(identity_secret: field) -> field {
        let inputs: [field; 4] = [IDENTITY_DOMAIN, identity_secret, 0field, 0field];
        return Poseidon4::hash_to_field(inputs);
    }

    inline derive_nullifier(identity_secret: field, scope_hash: field) -> field {
        let inputs: [field; 4] = [NULLIFIER_DOMAIN, identity_secret, scope_hash, 0field];
        return Poseidon4::hash_to_field(inputs);
    }

    inline make_root_key(group_id: u64, root: field) -> field {
        let inputs: [field; 4] = [ROOT_HISTORY_DOMAIN, group_id as field, root, 0field];
        return Poseidon4::hash_to_field(inputs);
    }

    inline make_member_slot_key(group_id: u64, leaf_index: u32) -> field {
        let inputs: [field; 4] = [MEMBER_SLOT_DOMAIN, group_id as field, leaf_index as field, 0field];
        return Poseidon4::hash_to_field(inputs);
    }

    inline make_member_commitment_key(group_id: u64, commitment: field) -> field {
        let inputs: [field; 4] = [MEMBER_COMMITMENT_DOMAIN, group_id as field, commitment, 0field];
        return Poseidon4::hash_to_field(inputs);
    }

    inline bind_message(message: [field; 2]) -> field {
        let inputs: [field; 2] = [message[0u8], message[1u8]];
        return Poseidon2::hash_to_field(inputs);
    }

    inline assert_padded_siblings(merkle_proof_length: u8, merkle_proof_siblings: [field; 20]) {
        for i: u8 in 0u8..MERKLE_DEPTH {
            if i >= merkle_proof_length {
                assert_eq(merkle_proof_siblings[i], 0field);
            }
        }
    }

    inline rebuild_merkle_root(
        leaf: field,
        merkle_proof_length: u8,
        merkle_proof_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> field {
        assert(merkle_proof_length <= MERKLE_DEPTH);
        assert_padded_siblings(merkle_proof_length, merkle_proof_siblings);

        let node: field = leaf;
        let index_cursor: u32 = merkle_proof_index;

        for i: u8 in 0u8..MERKLE_DEPTH {
            if i < merkle_proof_length {
                let sibling: field = merkle_proof_siblings[i];
                if index_cursor % 2u32 == 1u32 {
                    node = tree_hash(sibling, node);
                } else {
                    node = tree_hash(node, sibling);
                }
                index_cursor = index_cursor / 2u32;
            }
        }

        return node;
    }

    inline rebuild_append_prev_root(
        merkle_proof_length: u8,
        append_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> field {
        assert(merkle_proof_length <= MERKLE_DEPTH);
        assert_padded_siblings(merkle_proof_length, merkle_proof_siblings);

        let cursor: u32 = append_index;
        let node: field = 0field;
        let has_node: bool = false;
        let consumed_siblings: u8 = 0u8;

        for level: u8 in 0u8..MERKLE_DEPTH {
            let sibling: field = merkle_proof_siblings[level];
            if cursor > 0u32 {
                if cursor % 2u32 == 1u32 {
                    if has_node {
                        node = tree_hash(sibling, node);
                    } else {
                        node = sibling;
                        has_node = true;
                    }
                    consumed_siblings = consumed_siblings + 1u8;
                } else {
                    assert_eq(sibling, 0field);
                }
                cursor = cursor / 2u32;
            } else {
                assert_eq(sibling, 0field);
            }
        }

        assert_eq(consumed_siblings, merkle_proof_length);
        if has_node {
            return node;
        }

        return 0field;
    }

    inline rebuild_append_next_root(
        new_commitment: field,
        merkle_proof_length: u8,
        append_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> field {
        assert(merkle_proof_length <= MERKLE_DEPTH);
        assert_padded_siblings(merkle_proof_length, merkle_proof_siblings);

        let cursor: u32 = append_index;
        let node: field = new_commitment;
        let consumed_siblings: u8 = 0u8;

        for level: u8 in 0u8..MERKLE_DEPTH {
            let sibling: field = merkle_proof_siblings[level];
            if cursor > 0u32 {
                if cursor % 2u32 == 1u32 {
                    node = tree_hash(sibling, node);
                    consumed_siblings = consumed_siblings + 1u8;
                } else {
                    assert_eq(sibling, 0field);
                }
                cursor = cursor / 2u32;
            } else {
                assert_eq(sibling, 0field);
            }
        }

        assert_eq(consumed_siblings, merkle_proof_length);
        return node;
    }

    async transition initialize(public initial_admin: address) -> Future {
        return finalize_initialize(initial_admin);
    }

    async function finalize_initialize(initial_admin: address) {
        let already_initialized: bool = Mapping::get_or_use(initialized, 0u8, false);
        assert_eq(already_initialized, false);
        Mapping::set(initialized, 0u8, true);
        Mapping::set(program_admin, 0u8, initial_admin);
    }

    async transition transfer_ownership(public next_admin: address) -> Future {
        return finalize_transfer_ownership(self.caller, next_admin);
    }

    async function finalize_transfer_ownership(caller: address, next_admin: address) {
        let is_initialized: bool = Mapping::get_or_use(initialized, 0u8, false);
        assert_eq(is_initialized, true);

        let stored_program_admin: address = Mapping::get_or_use(program_admin, 0u8, caller);
        assert_eq(caller, stored_program_admin);
        Mapping::set(program_admin, 0u8, next_admin);
    }

    async transition create_group(public group_id: u64, public admin: address) -> Future {
        return finalize_create_group(group_id, admin);
    }

    async function finalize_create_group(group_id: u64, admin: address) {
        let is_initialized: bool = Mapping::get_or_use(initialized, 0u8, false);
        assert_eq(is_initialized, true);

        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, false);

        Mapping::set(group_exists, group_id, true);
        Mapping::set(group_admin, group_id, admin);
        Mapping::set(group_depth, group_id, MERKLE_DEPTH);
        Mapping::set(group_active_members, group_id, 0u32);
        Mapping::set(group_next_index, group_id, 0u32);
        Mapping::set(group_root, group_id, 0field);
        Mapping::set(group_root_valid, make_root_key(group_id, 0field), true);
    }

    async transition set_group_admin(public group_id: u64, public next_admin: address) -> Future {
        return finalize_set_group_admin(self.caller, group_id, next_admin);
    }

    async function finalize_set_group_admin(caller: address, group_id: u64, next_admin: address) {
        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, true);

        let current_admin: address = Mapping::get_or_use(group_admin, group_id, caller);
        assert_eq(caller, current_admin);
        Mapping::set(group_admin, group_id, next_admin);
    }

    async transition add_member(
        public group_id: u64,
        public new_commitment: field,
        public current_root: field,
        merkle_proof_length: u8,
        merkle_proof_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> Future {
        assert_neq(new_commitment, 0field);

        let derived_current_root: field = rebuild_append_prev_root(
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        assert_eq(derived_current_root, current_root);

        let next_root: field = rebuild_append_next_root(
            new_commitment,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        return finalize_add_member(
            self.caller,
            group_id,
            new_commitment,
            current_root,
            merkle_proof_index,
            next_root
        );
    }

    async function finalize_add_member(
        caller: address,
        group_id: u64,
        new_commitment: field,
        current_root: field,
        append_index: u32,
        next_root: field
    ) {
        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, true);

        let current_admin: address = Mapping::get_or_use(group_admin, group_id, caller);
        assert_eq(caller, current_admin);

        let depth: u8 = Mapping::get_or_use(group_depth, group_id, 0u8);
        assert_eq(depth, MERKLE_DEPTH);

        let stored_root: field = Mapping::get_or_use(group_root, group_id, 0field);
        assert_eq(stored_root, current_root);

        let stored_append_index: u32 = Mapping::get_or_use(group_next_index, group_id, 0u32);
        assert_eq(stored_append_index, append_index);
        assert(append_index < MAX_GROUP_SIZE);

        let commitment_key: field = make_member_commitment_key(group_id, new_commitment);
        let is_active: bool = Mapping::get_or_use(group_commitment_active, commitment_key, false);
        assert_eq(is_active, false);

        let slot_key: field = make_member_slot_key(group_id, append_index);
        let slot_value: field = Mapping::get_or_use(group_member, slot_key, 0field);
        assert_eq(slot_value, 0field);

        let active_count: u32 = Mapping::get_or_use(group_active_members, group_id, 0u32);
        Mapping::set(group_member, slot_key, new_commitment);
        Mapping::set(group_member_index, commitment_key, append_index);
        Mapping::set(group_commitment_active, commitment_key, true);
        Mapping::set(group_active_members, group_id, active_count + 1u32);
        Mapping::set(group_next_index, group_id, append_index + 1u32);
        Mapping::set(group_root, group_id, next_root);
        Mapping::set(group_root_valid, make_root_key(group_id, next_root), true);
    }

    async transition update_member(
        public group_id: u64,
        public leaf_index: u32,
        public old_commitment: field,
        public new_commitment: field,
        public current_root: field,
        merkle_proof_length: u8,
        merkle_proof_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> Future {
        assert_neq(new_commitment, 0field);
        assert_neq(old_commitment, new_commitment);
        assert_eq(merkle_proof_index, leaf_index);

        let derived_current_root: field = rebuild_merkle_root(
            old_commitment,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        assert_eq(derived_current_root, current_root);

        let next_root: field = rebuild_merkle_root(
            new_commitment,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        return finalize_update_member(
            self.caller,
            group_id,
            leaf_index,
            old_commitment,
            new_commitment,
            current_root,
            next_root
        );
    }

    async function finalize_update_member(
        caller: address,
        group_id: u64,
        leaf_index: u32,
        old_commitment: field,
        new_commitment: field,
        current_root: field,
        next_root: field
    ) {
        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, true);

        let current_admin: address = Mapping::get_or_use(group_admin, group_id, caller);
        assert_eq(caller, current_admin);

        let stored_root: field = Mapping::get_or_use(group_root, group_id, 0field);
        assert_eq(stored_root, current_root);

        let old_commitment_key: field = make_member_commitment_key(group_id, old_commitment);
        let new_commitment_key: field = make_member_commitment_key(group_id, new_commitment);
        let old_is_active: bool = Mapping::get_or_use(group_commitment_active, old_commitment_key, false);
        let new_is_active: bool = Mapping::get_or_use(group_commitment_active, new_commitment_key, false);
        assert_eq(old_is_active, true);
        assert_eq(new_is_active, false);

        let stored_leaf_index: u32 = Mapping::get_or_use(group_member_index, old_commitment_key, 0u32);
        assert_eq(stored_leaf_index, leaf_index);

        let slot_key: field = make_member_slot_key(group_id, leaf_index);
        let slot_value: field = Mapping::get_or_use(group_member, slot_key, 0field);
        assert_eq(slot_value, old_commitment);

        Mapping::set(group_member, slot_key, new_commitment);
        Mapping::remove(group_member_index, old_commitment_key);
        Mapping::set(group_commitment_active, old_commitment_key, false);
        Mapping::set(group_member_index, new_commitment_key, leaf_index);
        Mapping::set(group_commitment_active, new_commitment_key, true);
        Mapping::set(group_root, group_id, next_root);
        Mapping::set(group_root_valid, make_root_key(group_id, next_root), true);
    }

    async transition remove_member(
        public group_id: u64,
        public leaf_index: u32,
        public old_commitment: field,
        public current_root: field,
        merkle_proof_length: u8,
        merkle_proof_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> Future {
        assert_eq(merkle_proof_index, leaf_index);

        let derived_current_root: field = rebuild_merkle_root(
            old_commitment,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        assert_eq(derived_current_root, current_root);

        let next_root: field = rebuild_merkle_root(
            0field,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        return finalize_remove_member(
            self.caller,
            group_id,
            leaf_index,
            old_commitment,
            current_root,
            next_root
        );
    }

    async function finalize_remove_member(
        caller: address,
        group_id: u64,
        leaf_index: u32,
        old_commitment: field,
        current_root: field,
        next_root: field
    ) {
        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, true);

        let current_admin: address = Mapping::get_or_use(group_admin, group_id, caller);
        assert_eq(caller, current_admin);

        let stored_root: field = Mapping::get_or_use(group_root, group_id, 0field);
        assert_eq(stored_root, current_root);

        let old_commitment_key: field = make_member_commitment_key(group_id, old_commitment);
        let old_is_active: bool = Mapping::get_or_use(group_commitment_active, old_commitment_key, false);
        assert_eq(old_is_active, true);

        let stored_leaf_index: u32 = Mapping::get_or_use(group_member_index, old_commitment_key, 0u32);
        assert_eq(stored_leaf_index, leaf_index);

        let slot_key: field = make_member_slot_key(group_id, leaf_index);
        let slot_value: field = Mapping::get_or_use(group_member, slot_key, 0field);
        assert_eq(slot_value, old_commitment);

        let active_count: u32 = Mapping::get_or_use(group_active_members, group_id, 0u32);
        assert(active_count > 0u32);

        Mapping::set(group_member, slot_key, 0field);
        Mapping::remove(group_member_index, old_commitment_key);
        Mapping::set(group_commitment_active, old_commitment_key, false);
        Mapping::set(group_active_members, group_id, active_count - 1u32);
        Mapping::set(group_root, group_id, next_root);
        Mapping::set(group_root_valid, make_root_key(group_id, next_root), true);
    }

    async transition validate_proof_depth_20(
        public group_id: u64,
        public merkle_root: field,
        public nullifier: field,
        public message: [field; 2],
        public scope_hash: field,
        identity_secret: field,
        merkle_proof_length: u8,
        merkle_proof_index: u32,
        merkle_proof_siblings: [field; 20]
    ) -> Future {
        let derived_commitment: field = derive_identity_commitment(identity_secret);
        let derived_root: field = rebuild_merkle_root(
            derived_commitment,
            merkle_proof_length,
            merkle_proof_index,
            merkle_proof_siblings
        );
        assert_eq(derived_root, merkle_root);

        let derived_nullifier: field = derive_nullifier(identity_secret, scope_hash);
        assert_eq(derived_nullifier, nullifier);

        let message_binding: field = bind_message(message);
        return finalize_validate_proof(group_id, merkle_root, nullifier, message_binding);
    }

    async function finalize_validate_proof(
        group_id: u64,
        merkle_root: field,
        nullifier: field,
        message_binding: field
    ) {
        let exists: bool = Mapping::get_or_use(group_exists, group_id, false);
        assert_eq(exists, true);

        let root_is_valid: bool = Mapping::get_or_use(
            group_root_valid,
            make_root_key(group_id, merkle_root),
            false
        );
        assert_eq(root_is_valid, true);

        let already_used: bool = Mapping::get_or_use(nullifier_used, nullifier, false);
        assert_eq(already_used, false);

        let rebound: field = message_binding + 0field;
        assert_eq(rebound, message_binding);
        Mapping::set(nullifier_used, nullifier, true);
    }

    transition is_supported_depth(public merkle_depth: u8) -> bool {
        return merkle_depth == MERKLE_DEPTH;
    }
}
