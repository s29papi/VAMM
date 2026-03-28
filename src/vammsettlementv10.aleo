import credits.aleo;
import test_usdcx_stablecoin.aleo;

program vammsettlementv10.aleo;

struct RequesterBounds:
    min_payout as u64;
    max_payout as u64;

struct DelegatedIntent:
    order_id as u64;
    approval_amount as u128;
    requester as address;
    recipient as address;
    expiry_timestamp as i64;
    bounds_hash as field;

mapping requester_by_order:
    key as u64.public;
    value as address.public;

mapping ephemeral_by_order:
    key as u64.public;
    value as address.public;

mapping recipient_by_order:
    key as u64.public;
    value as address.public;

mapping order_used:
    key as u64.public;
    value as boolean.public;

mapping ephemeral_used:
    key as address.public;
    value as boolean.public;

constructor:
    assert.eq edition 0u16;

function authorize_order:
    input r0 as u64.public;
    input r1 as address.public;
    input r2 as address.public;
    assert.neq r0 0u64;
    assert.eq self.caller self.signer;
    async authorize_order self.signer r0 r1 r2 into r3;
    output r3 as vammsettlementv10.aleo/authorize_order.future;

finalize authorize_order:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as address.public;

    contains order_used[r1] into r4;
    assert.eq r4 false;

    contains ephemeral_used[r2] into r5;
    assert.eq r5 false;

    set r0 into requester_by_order[r1];
    set r2 into ephemeral_by_order[r1];
    set r3 into recipient_by_order[r1];
    set false into order_used[r1];
    set false into ephemeral_used[r2];

function settle_order:
    input r0 as u64.public;
    input r1 as u128.public;
    input r2 as credits.aleo/credits.record;
    input r3 as address.public;
    input r4 as address.private;
    input r5 as address.public;
    input r6 as address.private;
    input r7 as u64.private;
    input r8 as u64.private;
    input r9 as i64.public;
    input r10 as field.public;
    input r11 as address.public;
    input r12 as signature.public;

    assert.neq r0 0u64;
    assert.neq r1 0u128;
    assert.eq r5 r6;

    cast r7 r8 into r13 as RequesterBounds;
    hash.psd2.raw r13 into r14 as field;
    assert.eq r14 r10;

    cast r0 r1 r3 r5 r9 r10 into r15 as DelegatedIntent;
    hash.psd2.raw r15 into r16 as field;
    cast r16 into r17 as [field; 1u32];
    sign.verify r12 r11 r17 into r18;
    assert.eq r18 true;

    gte r2.microcredits r7 into r19;
    assert.eq r19 true;
    lte r2.microcredits r8 into r20;
    assert.eq r20 true;

    call test_usdcx_stablecoin.aleo/transfer_from_public_to_private r3 r4 r1 into r21 r22 r23;
    call credits.aleo/transfer_private r2 r6 r2.microcredits into r24 r25;
    async settle_order r23 r0 r3 r5 r11 r9 into r26;

    output r21 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r22 as test_usdcx_stablecoin.aleo/Token.record;
    output r24 as credits.aleo/credits.record;
    output r25 as credits.aleo/credits.record;
    output r26 as vammsettlementv10.aleo/settle_order.future;

finalize settle_order:
    input r0 as test_usdcx_stablecoin.aleo/transfer_from_public_to_private.future;
    input r1 as u64.public;
    input r2 as address.public;
    input r3 as address.public;
    input r4 as address.public;
    input r5 as i64.public;

    contains requester_by_order[r1] into r6;
    assert.eq r6 true;
    get requester_by_order[r1] into r7;
    assert.eq r7 r2;

    contains ephemeral_by_order[r1] into r8;
    assert.eq r8 true;
    get ephemeral_by_order[r1] into r9;
    assert.eq r9 r4;

    contains recipient_by_order[r1] into r10;
    assert.eq r10 true;
    get recipient_by_order[r1] into r11;
    assert.eq r11 r3;

    contains order_used[r1] into r12;
    assert.eq r12 true;
    get.or_use order_used[r1] false into r13;
    assert.eq r13 false;
    set true into order_used[r1];

    contains ephemeral_used[r4] into r14;
    assert.eq r14 true;
    get.or_use ephemeral_used[r4] false into r15;
    assert.eq r15 false;
    set true into ephemeral_used[r4];

    lte block.timestamp r5 into r16;
    assert.eq r16 true;

    await r0;
