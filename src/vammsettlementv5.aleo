import credits.aleo;
import test_usdcx_stablecoin.aleo;

program vammsettlementv5.aleo;

constructor:
    assert.eq edition 0u16;

function settle_order:
    input r0 as u64.public;
    input r1 as u128.public;
    input r2 as credits.aleo/credits.record;
    input r3 as address.public;
    input r4 as address.private;
    input r5 as address.private;
    input r6 as u64.private;
    input r7 as u64.private;
    input r8 as i64.public;

    assert.neq r0 0u64;
    assert.neq r1 0u128;
    gte r2.microcredits r6 into r9;
    assert.eq r9 true;
    lte r2.microcredits r7 into r10;
    assert.eq r10 true;

    call test_usdcx_stablecoin.aleo/transfer_from_public_to_private r3 r4 r1 into r11 r12 r13;
    call credits.aleo/transfer_private r2 r5 r2.microcredits into r14 r15;
    async settle_order r13 r8 into r16;

    output r11 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r12 as test_usdcx_stablecoin.aleo/Token.record;
    output r14 as credits.aleo/credits.record;
    output r15 as credits.aleo/credits.record;
    output r16 as vammsettlementv5.aleo/settle_order.future;

finalize settle_order:
    input r0 as test_usdcx_stablecoin.aleo/transfer_from_public_to_private.future;
    input r1 as i64.public;

    lte block.timestamp r1 into r2;
    assert.eq r2 true;
    await r0;
