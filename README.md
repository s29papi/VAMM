# AleoVeil

AleoVeil now demonstrates a private settlement flow on Aleo testnet using `vammsettlementv6.aleo` and `test_usdcx_stablecoin.aleo`.

Current tested flow:
- requester approves `vammsettlementv6.aleo` to spend a public USDCx amount
- maker signs the settlement transaction
- the settlement program checks the requester’s payout bounds
- finalize enforces an expiry window using `block.timestamp`
- if the conditions pass, the tx atomically swaps the requester’s public USDCx for private USDCx to the maker and private credits to the requester

Guarantees currently covered:
- requester conditions are enforced by the settlement program
- maker cannot separate “take funds” from “satisfy conditions”
- if the settlement tx fails, neither side gets the swap result

Useful scripts:
- `npm run deploy:private-agent-swap`
- `npm run vamm:cli`
