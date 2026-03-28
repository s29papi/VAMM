# VAMM

VAMM is an agent-native AMM prototype on Aleo. It lets agents act as market makers with defined strategies, while letting users execute against them privately and trustlessly.

In the current demo, a user creates a delegated order from the frontend, approves the settlement path, authorizes a one-time ephemeral signer, and forwards that payload to VAMM. VAMM then executes the maker side and settles through an Aleo program that privately moves value between the parties.

Repository: https://github.com/s29papi/VAMM

## What is VAMM?

VAMM is infrastructure for programmable agent market makers.

Instead of treating market makers as opaque offchain bots, VAMM models them as agents with explicit strategies. Users define constrained intents, VAMM executes within those constraints, and Aleo enforces settlement onchain.

The current implementation uses:

- a React frontend for the requester flow
- an Aleo settlement program for execution guarantees
- a Hermes-based VAMM layer for strategy representation and maker-side execution

## Key Features

- Private settlement path: settlement privately credits the market maker and privately credits the requester.
- Trustless execution: requester bounds and expiry are enforced by the Aleo program.
- Agent-defined strategies: VAMM exposes a strategy layer so market-maker behavior can be represented explicitly.
- Delegated execution model: the user authorizes a one-time ephemeral signer instead of relying on a reusable signing path.
- Frontend-to-agent handoff: the frontend can forward a completed delegated payload directly to the VAMM maker API.

## Current Privacy Model

Current guarantees:

- requester payout bounds are enforced onchain
- the market maker cannot take funds without satisfying settlement conditions
- settlement moves value privately once execution occurs
- delegated authorization is replay-resistant in the intended flow

Current public surface:

- `approve_public` is public
- `authorize_order` is public
- transfer and settlement are private

So the current privacy gap is the approval plus ephemeral-key authorization step. The actual settlement path is private.

## Getting Started

### Prerequisites

- Node.js
- npm
- an Aleo testnet environment configured through local `.env`

### Install

```bash
npm install
npm --prefix interfaces/frontend install
```

### Frontend Demo Flow

```bash
npm run vamm:frontend:dev
```

The current flow is:

1. User opens the frontend.
2. The frontend prices the request using the active strategy context.
3. The user signs and authorizes the delegated requester flow.
4. The frontend forwards the payload to the VAMM maker API.
5. VAMM executes the maker side and runs `settle_order`.
6. The resulting settlement transaction can be inspected on the Provable explorer.

## Architecture Overview

```text
src/                          Aleo settlement program versions
scripts/                      Node execution and proving scripts
interfaces/frontend/          Requester UI
interfaces/cli/               Local VAMM CLI helpers
interfaces/tool/              Tool-facing VAMM runtime shim
Hermes Agent repo              VAMM mode, strategy layer, and maker API integration
```

### Frontend requester flow

Frontend code lives in:

- `interfaces/frontend/`
- `interfaces/frontend/src/App.jsx`
- `interfaces/frontend/src/requester-intent.js`

Responsibilities:

- price the request using the current strategy context
- build delegated intent payloads
- call wallet `executeTransaction()` for `authorize_order` and `approve_public`
- forward completed payloads to the VAMM API

### Settlement program

Settlement program versions live in:

- `src/`

Current active program source:

- `vammsettlementv10.aleo`

Current active program address:

- `aleo10cg7xzs7z8pegkskuy3dd89a5fxq0rm854zfpsvehp9rgnpuhuysjzwff0`

Source code location:

- `src/vammsettlementv10.aleo`

Frontend configuration location:

- `interfaces/frontend/src/requester-intent.js`

It enforces:

- expiry
- payout bounds
- delegated authorization checks
- private transfer path during settlement

### Maker execution

Maker execution lives in:

- `scripts/execute-requester-order.mjs`

It:

- validates delegated payloads
- verifies `authorize_tx_id` and `approval_tx_id`
- funds the maker side
- executes `settle_order`

Related scripts:

- `scripts/authorize-order-direct.mjs`
- `scripts/deploy-private-agent-swap.mjs`

### Strategy layer

The VAMM strategy surface lives in:

- `https://github.com/s29papi/hermes-agent/tree/main/tools/vamm_strategies`

Registry:

- `https://github.com/s29papi/hermes-agent/blob/main/tools/vamm_strategies/registry.py`

This is the intended extension point for developer-defined market-maker strategies.

## How We Built It

We built VAMM around a delegated execution model.

The user defines an order, min/max payout bounds, and an expiry. The frontend creates a delegated intent hash, authorizes a non-reusable ephemeral signer, and produces a payload that can be handed to the market maker. VAMM then executes the maker side, and the Aleo settlement program enforces the final swap conditions.

## Challenges

Two issues shaped the current design:

- `signMessage` and `signValue` were inconsistent, and verification was not straightforward
- wallet flows did not always expose clean final onchain transaction ids

The signature issue led to the delegated one-time ephemeral key model. That gave the system a cleaner replay-resistant authorization boundary than relying on brittle reusable signing semantics.

## What We Learned

- Private trustless exchange is not just a settlement-program problem; wallet behavior and signing semantics matter a lot.
- A delegated ephemeral authorization model fits agent execution well.
- Strategy representation matters for the product story: agents should look like programmable AMMs, not hidden bots.
- Aleo gives a strong privacy base, but the user-authorization surface still needs refinement.

## Current Limitations

- approval and ephemeral authorization are still public
- wallet adapters differ in how they expose final transaction ids
- the Hermes VAMM API is still a thin execution wrapper, not yet a full autonomous market-maker runtime

## What's Next

- add more VAMM strategies
- reduce the remaining public approval surface
- improve wallet-agnostic transaction tracking
- make the strategy layer more developer-facing
- evolve VAMM from a demo execution wrapper into a fuller programmable agent AMM system

## License

This repository currently follows the project license in the repo root.
