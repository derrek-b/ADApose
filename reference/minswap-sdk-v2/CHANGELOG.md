# Changelog

All notable changes to `@minswap/sdk-v2` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-28

Initial release. A clean, standalone TypeScript client for the Minswap API,
migrated from [`@minswap/sdk`](https://github.com/minswap/sdk) (v1) — the legacy
Lucid transaction builder is intentionally left behind. This package is only the
new API client.

### Added

- **`MinswapSdk`** root client. Construct once, reach each area through its module.
- **Reads** — `token` (lookup, listing, OHLC, trade history), `pool` (listing,
  lookup, charts, events), `portfolio` (a wallet's LP / farm / staking positions),
  `order` (DEX order history across protocols).
- **`aggregator`** — swap `estimate`, `buildTx`, `submitTx`, `cancelOrders`,
  `getPendingOrders`. The only submit path in the SDK.
- **`liquidity`** — client-side **add / remove / zap-in / zap-out** across
  **DEX V2**, **DEX V1**, and **Stableswap**. Callers pass only a pair (or LP
  token) + amount + slippage; the SDK resolves the pool and version, decodes
  on-chain state, computes minimums, and returns unsigned order CBOR. Amounts
  accept raw base units or decimal-normalized form (LP token is always raw).
- **`farm`** — `list`, `getPositions`, `deposit`, `withdraw`, `harvest`,
  `emergencyWithdraw`, with automatic first-deposit vs. add and partial vs. full
  withdraw routing.
- **`staking`** — MIN staking `list`, `getPositions`, `stake`, `unstake`, with
  automatic tiered vs. flexible routing.
- **`RpcProvider`** interface plus a ready-made **`KupoRpcProvider`** for the
  wallet UTxOs that liquidity, farm, and staking actions require; `selectCollateral`
  and related helpers.
- **Optional peer** `@minswap/internal-sdk` (Node-only, lazily loaded) for the
  Kupo → CBOR path and client-side liquidity order assembly.
- Typed **`MinswapError`** (`code` → typed `details`) for every failure; Zod
  validation at the trust boundary; camelCase responses mapped from the backends'
  snake_case.
- Pagination helpers (`paginate`, `collect`) and token-id converters
  (`coinIdToAssetUnit`, `assetUnitToCoinId`, `coinIdToInputAsset`).
- **Packaging** — dual ESM + CJS builds with `.d.ts` types; tree-shakeable;
  `@minswap/internal-sdk` kept external so it is never required at import time.

### Notes

- The SDK **never signs or submits** — action methods return CBOR for the caller
  to sign. Server-partially-signed CBOR (aggregator cancel, farm/staking) must be
  `partialSign`-ed and assembled, not replaced.
- On failure the SDK always **throws** a typed error; it never returns `null`.
- Liquidity orders are built client-side and verified **byte-identical** to the
  production `@minswap/sdk` builder (order address + value + datum) across all
  ops × pool versions.
- mainnet only; every endpoint is overridable via config.

[1.0.0]: https://github.com/minswap/minswap-sdk-v2/releases/tag/v1.0.0
