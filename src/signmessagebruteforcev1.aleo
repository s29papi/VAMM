program signmessagebruteforcev1.aleo;

constructor:
    assert.eq edition 0u16;

function verify_as_single_field:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as signature.public;

    cast r1 into r3 as [field; 1u32];
    sign.verify r2 r0 r3 into r4;
    output r4 as boolean.public;

function verify_as_two_fields:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as signature.public;

    cast r1 r2 into r4 as [field; 2u32];
    sign.verify r3 r0 r4 into r5;
    output r5 as boolean.public;

function verify_as_three_fields:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as field.public;
    input r3 as field.public;
    input r4 as signature.public;

    cast r1 r2 r3 into r5 as [field; 3u32];
    sign.verify r4 r0 r5 into r6;
    output r6 as boolean.public;
