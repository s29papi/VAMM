// The 'test_veil_semaphore_v1' test program.
import veil_semaphore_v1.aleo;

program test_veil_semaphore_v1.aleo {
    @test
    script supports_depth_20() {
        let supported: bool = veil_semaphore_v1.aleo/is_supported_depth(20u8);
        assert_eq(supported, true);
    }

    @test
    script validates_public_tuple() {
        let result: (u64, field, field, field, field) = veil_semaphore_v1.aleo/validate_proof_depth_20(
            1u64,
            20u8,
            10field,
            20field,
            30field,
            40field,
            50scalar
        );

        assert_eq(result.0, 1u64);
        assert_eq(result.1, 10field);
        assert_eq(result.2, 20field);
        assert_eq(result.3, 30field);
        assert_eq(result.4, 40field);
    }

    @test
    @should_fail
    transition rejects_non_depth_20() {
        let result: (u64, field, field, field, field) = veil_semaphore_v1.aleo/validate_proof_depth_20(
            1u64,
            19u8,
            10field,
            20field,
            30field,
            40field,
            50scalar
        );
    }

    @noupgrade
    async constructor() {}
}
