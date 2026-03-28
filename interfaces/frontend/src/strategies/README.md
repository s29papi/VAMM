# VAMM Strategies

This directory is the frontend strategy surface for VAMM market makers.

Current strategy:

- `coingecko.js`: derives ALEO/USD market context from CoinGecko and feeds the requester quote flow.

How to add a strategy:

1. Create a new module in this directory.
2. Export a strategy object with:
   - `id`
   - `label`
   - `description`
   - `getMarketContext()`
3. Register it in [`index.js`](./index.js).

The goal is for VAMM to look like a programmable agent AMM:
developers write strategies, and users execute privately against them.
