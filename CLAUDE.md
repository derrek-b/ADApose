# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pomona Finance — non-custodial auto-compounding yield vaults for Cardano LP positions (Minswap V2 first). **Status: pre-build.** Most source files are design-artifact skeletons or one-line stubs; `docs/decisions.md` is the authoritative design record (D1–D14) and should be read before implementing anything, and updated (dated entries) when a design decision is made or changed.

Use `/commit` to commit (it also checks code-coupled docs for staleness afterward) and `/update-brain` at the end of a working session (captures decisions into `docs/decisions.md`, session history into `CHANGELOG.md`). `reference/` is vendored read-only; `docs/crib_sheet.md` is a frozen interview artifact — never edit either.

## Commands

**Validator (`validators/`, Aiken v1.1.23, Plutus V3):**
```bash
cd validators
aiken check          # typecheck + run unit tests
aiken check -m NAME  # run tests matching NAME
aiken build          # compile to plutus.json blueprint
```

**Executor (`executor/`, Node ESM + TypeScript):**
```bash
cd executor
npm install               # requires .npmrc (JSR registry) — already committed
npm run dev               # tsx src/service/main.ts
npm test                  # vitest (watch); npx vitest run for single pass
npx vitest run path/to/file.test.ts   # single test file
npm run build             # tsc
npx tsx src/smoke-test.ts # verifies .env.local + Blockfrost + Lucid + executor wallet
```

Executor needs `executor/.env.local` (gitignored) with `BLOCKFROST_PROJECT_ID`, `BLOCKFROST_BASE_URL`, `EXECUTOR_SEED_PHRASE`, `NETWORK=preprod`. See `.env.example`.

**Web (`web/`):** not scaffolded yet — planned React + Vite + Mesh SDK (CIP-30 wallet connect).

## Critical toolchain fact

Transaction building uses **@spacebudz/lucid v0.20 (SpaceBudz Lucid), NOT Lucid Evolution** — @minswap/sdk's API is built on SpaceBudz Lucid, so the whole stack standardized on it (decision D7). It's published on JSR, hence the npm alias in package.json (`npm:@jsr/spacebudz__lucid`) and `executor/.npmrc` pointing `@jsr` at `https://npm.jsr.io`. Don't "upgrade" to lucid-evolution or lucid-cardano.

## Architecture

Three components around one security model:

- **`validators/validators/vault.ak`** — on-chain. One validator per DEX; all pools share one script address, each vault bound to its pool via the datum (D11). One UTXO per user, owner pubkey in the datum (D1 — deliberately not a shared/share-token vault). Four redeemer paths in v1: Deposit (owner-signed top-up), Withdraw (owner-signed, **full withdraw only**, settles accrued fees to treasury — D14), Compound (executor-signed, accrue-only: `fee_owed += fee_bps × ΔLP` in LP units — D13), Rescue (treasury-signed, stray UTxOs with missing/unparseable datums only — D10). The **asymmetry is the security model** (D2): the owner path proves identity; the executor path constrains everything — value may only grow, datum immutables (owner, pool_id) preserved, swap price above the on-chain slippage floor read from the pool reference input (D12 — the adaptive tolerance lives in executor code, not on-chain). A compromised executor key can grief cadence but cannot extract funds. No deploy step: validator hash = address; publish as reference script. Parameters bake into the hash — changing executor/treasury/fee means a new address and user migration (D11).

- **`executor/`** — off-chain 24/7 service. Intended flow: `chain/indexer` watches vault UTXOs → `strategies/trigger` decides which vaults to compound (rule: accrued rewards ≥ 2× marginal cost — profitability is an invariant, not a forecast; D3) → `operations/compound_batch` builds one atomic batch tx (claim MIN farm rewards → swap to pool assets → re-add liquidity → restake, ~20–30 vaults per tx given the 16KB limit) via `adapters/minswap_v2` + `chain/tx_builder`, orchestrated by `service/scheduler`/`main`. All of these are currently stubs; `smoke-test.ts` is the only working code.

- **`reference/`** — vendored read-only material: Minswap AMM V2 spec, formula.md, farm docs, and a full @minswap/sdk snapshot (`reference/sdk`, pinned commit in `VENDORED_COMMIT`). Consult it, don't modify it. Notable facts already mined from it (D5): batcher fee is 2 ADA flat per order; imbalanced/single-sided deposits are native to the pool; `createBulkOrdersTx` supports the multi-order batch pattern first-class; Minswap V2 is constant-product only (no concentrated liquidity exists).

## Target DEX is unsettled (D6, D15, D16)

Minswap V2 farming is **blocked for auto-compounding**: script addresses can't own farm positions AND every farm spend needs Minswap's hardcoded admin co-sign (D6, UPLC decode vendored at `reference/farm-onchain/`). This forced a five-DEX pivot survey (D15): SundaeSwap (off-chain team-computed rewards) and Danogo (no LP farm) are dead ends, Splash isn't live. **WingRiders is the leading candidate** (D16): open-source Plutarch contracts, script-address beneficiaries allowed, farm lock is owner-recoverable (non-custodial), WRT rewards are agent-distributed — so the model is *post-receipt compounding*, not permissionless harvest. On-chain decode artifacts vendored at `reference/wingriders-onchain/` and `reference/dex-survey/`. Two go/no-go confirmations remain — see `docs/week1-verify.md` (WingRiders reward destination + current farm model). This also revises D8's Phase-2 target. Note: reward-flow verification needs a **mainnet** query source; the executor's Blockfrost key is preprod-only.

## Dev loop

`aiken check` → Lucid emulator → Yaci DevKit (unverified) → preprod testnet (Minswap is deployed there; both project wallets are faucet-funded) → mainnet. Unaudited = own capped capital only.

`docs/week1-verify.md` is the checklist of unproven assumptions the design leans on — work it top-down (the architecture-deciding items first); a contradicting result means writing a superseding D-entry, not silently patching.
