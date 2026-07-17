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
| `docs/` | Design decisions, cost model, open questions |

## Stack

- **Aiken** — validator language (compiles to Plutus V3)
- **Lucid Evolution** — transaction building (executor + web)
- **@minswap/sdk** — Minswap order construction, pool reads, calc helpers
- **Blockfrost / Maestro** — chain indexing
- **Mesh SDK** — CIP-30 wallet connect (web)
- Dev loop: `aiken check` → Lucid emulator → Yaci DevKit → preprod → mainnet

## The product in one paragraph

Each user's position is a UTXO at the vault validator's script address, owner recorded
in the datum. The 24/7 executor watches vaults, and when a vault's accrued rewards cover
2× its marginal compound cost, it batches it into the next compound round: claim MIN from
the Minswap farm → swap to pool assets → re-add liquidity → restake — one atomic
transaction per batch. The validator enforces: executor can compound but never extract;
only the owner's signature moves funds out. Fees: 4.5% of harvested emissions, enforced
on-chain. See `docs/decisions.md` for the full design record.
