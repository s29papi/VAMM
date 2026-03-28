import credits.aleo;
import test_usdcx_stablecoin.aleo;

program vammsettlementv9.aleo;

struct RequesterBounds:
    min_payout as u64;
    max_payout as u64;

struct RequesterIntent:
    order_id as u64;
    approval_amount as u128;
    requester as address;
    expiry_timestamp as i64;
    bounds_hash as field;

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
    input r9 as field.public;
    input r10 as signature.public;

    assert.neq r0 0u64;
    assert.neq r1 0u128;
    assert.eq r3 r5;

    cast r6 r7 into r11 as RequesterBounds;
    hash.psd2.raw r11 into r12 as field;
    assert.eq r12 r9;

    cast r0 r1 r3 r8 r9 into r13 as RequesterIntent;
    hash.psd2.raw r13 into r14 as field;
    cast r14 into r15 as [field; 1u32];
    sign.verify r10 r3 r15 into r16;
    assert.eq r16 true;

    gte r2.microcredits r6 into r17;
    assert.eq r17 true;
    lte r2.microcredits r7 into r18;
    assert.eq r18 true;

    call test_usdcx_stablecoin.aleo/transfer_from_public_to_private r3 r4 r1 into r19 r20 r21;
    call credits.aleo/transfer_private r2 r5 r2.microcredits into r22 r23;
    async settle_order r21 r8 into r24;

    output r19 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r20 as test_usdcx_stablecoin.aleo/Token.record;
    output r22 as credits.aleo/credits.record;
    output r23 as credits.aleo/credits.record;
    output r24 as vammsettlementv9.aleo/settle_order.future;

finalize settle_order:
    input r0 as test_usdcx_stablecoin.aleo/transfer_from_public_to_private.future;
    input r1 as i64.public;

    lte block.timestamp r1 into r2;
    assert.eq r2 true;
    await r0;
