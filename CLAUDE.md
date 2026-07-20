# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pomona Finance — non-custodial auto-compounding yield vaults for Cardano LP positions (Minswap V2 first). **Status: pre-build.** Most source files are design-artifact skeletons or one-line stubs; `docs/decisions.md` is the authoritative design record (D1–D22; several early entries are marked SUPERSEDED — always check headers) and should be read before implementing anything, and updated (dated entries) when a design decision is made or changed. `docs/workflows/` holds the per-action implementation contracts (deposit, vault-init, compound, …) that sit between decisions.md and source — read the relevant one before coding a path. `docs/v2-ideas.md` is the parked-features ledger (not commitments) — check it before proposing or re-deriving a deferred feature.

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
npm ci                    # exact lockfile install (requires .npmrc, JSR registry — committed). Use `ci`, not `install`: all deps are exact-pinned (D19) and `ci` refuses to drift the lockfile — the supply-chain guard for a hot-key service. `npm install` only when intentionally bumping a dep (review the diff before it reaches the key-holding machine).
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

- **`validators/validators/vault.ak`** — on-chain. **Pooled single-vault design (D20, supersedes the per-user D1 model):** one pooled vault UTXO per pool at our script address; users hold fungible share tokens (minted on deposit, burned on redemption); exchange rate = datum-tracked total_lp ÷ total_shares (farmed_lp is the farm-custody sub-ledger, never used for pricing). Redeemer paths: ApplyOrders (executor batches user deposit/redeem *orders* against the vault), EnterFarm (vault LP → executor-keyed Minswap farm position via the D19 API), ExitFarm (its mirror: farm-withdrawn LP back into the vault — buffer-miss redemptions, emergency-withdraw unwind; custody move only, rate untouched), RecordHarvest (post-compound: update farmed-LP, mint treasury shares = 4.5% of harvested gain — the fee design; no fee ledger, no settlement path), Rescue (treasury-signed, stray UTxOs only — D10). The farm layer is an executor-keyed aggregate position (Minswap allows one position per owner per pool) — custody there is executor-multisig, mitigated per D18 (MPC key, capped capital, proof-of-reserves) and bounded by the trustless emergency withdraw (D19). No deploy step: validator hash = address; publish as reference script.

## NON-NEGOTIABLE invariants (D20-N) — check before touching share math, mint/burn, or redemption

Pooling adopts the ERC-4626 attack class; these six conditions are the standing price, restated here so every session loads them. Each must be a named validator check with a matching test (`aiken check -m n1_` …). Any change touching them must state which it preserves. Full text in `docs/decisions.md` D20-N and the `vault.ak` header.

1. **N1 Datum-truth** — exchange rate only from datum totals, never from UTXO balances.
2. **N2 Dead shares** — fixed virtual share offset at init (kills first-depositor inflation).
3. **N3 House-favored rounding** — shares round down on mint, assets down on redeem; pool keeps every remainder.
4. **N4 Orders only** — users never spend the vault UTXO; deposit/redeem via owner-cancellable order UTxOs, executor-batched.
5. **N5 Custody honesty** — shares are a redemption claim dependent on executor liveness against an executor-keyed farm; no artifact may overstate sovereignty.
6. **N6 Thread-NFT authenticity** — a one-of-one state NFT (minted at init, carried in every vault spend) identifies THE vault UTXO; validator and share-mint policy key on the NFT, never on the address (kills counterfeit-vault share minting). Off-chain reads locate the vault by NFT too.

- **`executor/`** — off-chain 24/7 service. Intended flow (D19/D20 — the compound cycle is **multi-tx**, the old atomic-batch concept is dead): `chain/indexer` watches the pooled vault + user order UTxOs → `strategies/trigger` fires when the pool's aggregate accrued rewards ≥ 2× cycle cost (~5–7 ADA; D3 restated pool-level in D20) → `operations/compound_batch` runs the cycle: Minswap farm-API harvest tx → MIN→pool-assets swap order → add-liquidity order → API stake tx → `RecordHarvest` on the vault (treasury share mint); plus `ApplyOrders` batching of user deposit/redeem orders — via `adapters/minswap_v2` + `chain/tx_builder`, orchestrated by `service/scheduler`/`main`. **Every tx passes the independent CBOR verifier before the hot key signs (D19 — builder-agnostic, no exceptions).** DEX-specific construction lives behind the adapter interface; the verifier sits OUTSIDE the adapter boundary (D22). A `shared/` workspace package (planned, D22) holds datum codecs, rate math, and config that web + executor must agree on, deriving addresses/schemas from the aiken `plutus.json` blueprint — never hand-copied. All of these are currently stubs; `smoke-test.ts` is the only working code. Deps are exact-pinned; install with `npm run setup` (= `npm ci`), never bare `npm install`.

- **`reference/`** — vendored read-only material: Minswap AMM V2 spec, formula.md, farm docs, and a full @minswap/sdk snapshot (`reference/sdk`, pinned commit in `VENDORED_COMMIT`). Consult it, don't modify it. Notable facts already mined from it (D5): batcher fee is 2 ADA flat per order; imbalanced/single-sided deposits are native to the pool; `createBulkOrdersTx` supports the multi-order batch pattern first-class; Minswap V2 is constant-product only (no concentrated liquidity exists).

## Target DEX status (D6, D15–D19)

**Both Minswap and WingRiders are viable for auto-compounding — via executor-keyed farm positions only** (neither farm supports script owners; the custody model + invariant redesign is D18). Minswap was gated (every farm spend needs their co-sign, D6) but **resolved 2026-07-18: Minswap offers an official co-sign GraphQL API** (`reference/farm-docs/minswap-farm.md`, endpoint verified live) plus a trustless owner-only `EMERGENCY_WITHDRAW` (constructor 3) so principal is never hostage — D19 has the full analysis and a Minswap-vs-WingRiders tradeoff table. WingRiders (D16): rewards agent-pushed with no API dependency, preprod exists, but ~10× smaller TVL. SundaeSwap/Danogo are dead ends, Splash isn't live (D15 survey). A cross-DEX LP-router fallback that avoids farms entirely is D17 (field confirmed empty on Cardano). The old "one atomic compound tx" concept is dead on both DEXs — the cycle is multi-tx (D18/D19). Hard rule from D19: **never blind-sign API-built CBOR** — the executor must verify every server-built tx before signing. **Decided (D20): Phase 1 = pooled NIGHT/ADA vault on Minswap**, pitch-day demo, build window from 2026-08-17; WingRiders is the documented second venue. Evidence vendored under `reference/` (farm-onchain, wingriders-onchain, minswap-amm, dex-survey).

## Dev loop

`aiken check` → Lucid emulator → Yaci DevKit (unverified) → preprod testnet (Minswap is deployed there; both project wallets are faucet-funded) → mainnet. Unaudited = own capped capital only.

`docs/week1-verify.md` is the checklist of unproven assumptions the design leans on — work it top-down (the architecture-deciding items first); a contradicting result means writing a superseding D-entry, not silently patching.
