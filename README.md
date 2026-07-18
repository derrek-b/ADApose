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

Each user's position is a UTXO at the vault validator's script address, owner recorded
in the datum. The 24/7 executor watches vaults, and when a vault's accrued rewards cover
2× its marginal compound cost, it batches it into the next compound round: claim farm
rewards from the target DEX → swap to pool assets → re-add liquidity → restake — one
atomic batch. The validator enforces: executor can compound but never extract; only the
owner's signature moves funds out. Fees: 4.5% of harvested emissions, enforced on-chain.
**The target DEX is unsettled** — Minswap farming is co-sign-gated and WingRiders leads
the pivot options (decisions.md D15/D16); a cross-DEX LP-router fallback is D17. See
`docs/decisions.md` for the full design record.
