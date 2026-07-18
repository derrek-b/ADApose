# Pomona Finance

Non-custodial auto-compounding yield vaults for Cardano LP positions.

**Status:** pre-build — DraperU x Cardano Genesis Hacker House application (July 2026)

## Layout

| Dir | What |
|---|---|
| `validators/` | Aiken project — the vault validator (on-chain) |
| `executor/` | Node.js/TS service — chain watcher, trigger logic, batched compound txs (off-chain) |
| `web/` | React frontend — wallet connect, deposit/withdraw, position view |
| `reference/` | Vendored Minswap material: AMM V2 spec, formula.md, farm docs, SDK snapshot |
| `docs/` | Design decisions, workflow specs (`docs/workflows/`), cost model, open questions |

## Stack

- **Aiken** — validator language (compiles to Plutus V3)
- **@spacebudz/lucid v0.20** — transaction building (executor + web; via JSR — see decisions.md D7, deliberately NOT Lucid Evolution)
- **@minswap/sdk** — Minswap order construction, pool reads, calc helpers
- **Blockfrost / Maestro** — chain indexing
- **Mesh SDK** — CIP-30 wallet connect (web)
- Dev loop: `aiken check` → Lucid emulator → Yaci DevKit → preprod → mainnet

## Develop

```bash
cd validators && aiken check          # on-chain: typecheck + unit tests
cd executor   && npm run setup        # off-chain: exact-lockfile install (= npm ci)
```

Use **`npm run setup`** (or `npm ci`) for the executor, **not `npm install`** — all
deps are exact-pinned and `ci` refuses to drift the lockfile, which is the supply-chain
guard for a service that holds a hot signing key (decisions.md D19). `npm install` is
only for intentionally bumping a dependency, with the diff reviewed before it reaches
the key-holding machine. Full command list in `CLAUDE.md`.

## The product in one paragraph

Users deposit NIGHT, ADA, and/or LP tokens — any mix, one signature — into a pooled
vault (one per Minswap V2 pool) and receive fungible share tokens; the exchange rate
lives in the vault's datum. Deposits and redemptions ride owner-cancellable order
UTxOs that the 24/7 executor batches against the vault; the vault's LP is staked into
an executor-keyed Minswap farm position, and when accrued rewards cover ~2× the cycle
cost the executor runs the multi-tx compound cycle (harvest → swap → re-add liquidity
→ restake) and records the gain on-chain, minting the 4.5% performance fee as treasury
shares. Six non-negotiable invariants (D20-N) guard the share accounting on-chain.
Custody, honestly stated: shares are a redemption claim dependent on executor liveness
against an executor-keyed farm — but principal is never hostage (trustless
owner-only emergency withdraw, D19). Phase 1: pooled NIGHT/ADA vault on Minswap;
WingRiders is the documented second venue. Full record: `docs/decisions.md`;
per-action specs: `docs/workflows/`.
