# WingRiders official TS packages (vendored 2026-07-26)

Two small, official first-party packages (npm org `@wingriders`, GitHub org
`WingRiders`) — confirmed to exist via the npm registry and cross-checked against
`reference/wingriders-onchain/` (D16 evidence) before vendoring. There is **no**
`@wingriders/sdk` — unlike Minswap, WingRiders ships modular low-level packages
rather than one integrated SDK. A third package, `@wingriders/cab` (general
Cardano wallet/tx-building library, npm-confirmed to exist), was **not** vendored —
out of scope until WingRiders implementation actually starts (Phase 1 is Minswap
only, D20); pull it in then if it's still the right tool.

| Directory | Package | What it does | What it does NOT do |
|---|---|---|---|
| `dex-serializer/` | `@wingriders/dex-serializer` | PlutusData ser/deser for their datums (`RequestDatumV1`/`V2`, `LiquidityPoolDatumV1`/`V2`, `AssetClass`, `FarmDatum`, `VestingDatum`). Field names independently confirm the Haskell read in `wingriders-onchain/Types_Request.hs` (`oil`, `beneficiary`, `ownerAddress`, `compensationDatum`, `compensationDatumType`, `deadline`, `assetA`/`assetB`, `action`, `aScale`/`bScale` — exact match). | No pricing/quote math anywhere in `src/` (grepped) — `AddLiquidityAction` just wraps a caller-supplied `minWanted`, nothing computes it. |
| `dex-blockfrost-adapter/` | `@wingriders/dex-blockfrost-adapter` | Reads live pool state via Blockfrost (`getLiquidityPoolState`), computes **swap** quotes (`computeExpectedSwapAmount`/`computeExpectedRawSwapAmount`), ships real deployed constants (`constants.ts`: `REQUEST_SCRIPT_HASH`, `REQUEST_OIL = 2 ADA`, `REQUEST_BATCHER_FEE = 2 ADA`, `SWAP_FEE_IN_BASIS = 35` i.e. 0.35%, policy IDs). | No deposit/add-liquidity quote function — grepped the full `src/`, confirmed absent. Does not build or sign transactions (would need `@wingriders/cab` or an equivalent for that). |

**Confirms `docs/dex-adapters.md`'s finding, doesn't overturn it:** no official
off-chain library computes the WingRiders zap-in swap amount for an imbalanced
deposit (the `paddLiquidityZapIn` on-chain math in
`wingriders-onchain/Pool/ConstantProduct.hs`) — an `adapters/wingriders`
`quoteDeposit` would have to reimplement that solve independently, same
conclusion reached from the Haskell source alone, now cross-confirmed against
the actual published TS packages rather than inferred.

Fetched directly from each repo's `main` branch (raw GitHub, not `dist/` —
matches `reference/sdk`'s fidelity to real TS source over compiled output).
`src/`, `README.md`, `package.json`, `LICENSE.md` only — CI config, tests, and
examples omitted (evidence-focused vendoring, matching
`reference/wingriders-onchain/`'s selective style rather than `reference/sdk`'s
full-repo mirror).
