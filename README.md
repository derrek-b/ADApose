# ADApose Labs

Cardano DeFi automation. **Current direction (2026-07-30, D26 in
`docs/decisions.md`):** a fee-accrual allocation model, measured via the
constant-product pool invariant `√k = √(reserve_A · reserve_B)` — rises only
from trading fees, unaffected by swaps, deposits, withdrawals, or price
movement. Design docs: `docs/mechanism-sqrtk.md` (the invariant, vault state,
share issuance), `docs/fee-crystallization.md` (the fee model), and
`docs/workflows/` (per-action contracts — mostly stubs so far, the actual
flows aren't decided yet). `docs/adapose-sqrtk-vault-brief.md` was the
original proposal document; it's been mostly extracted into the docs above
and is being phased out, not the thing to read first anymore.

This replaces a farm-emissions auto-compounding vault (Minswap V2, pooled
single-vault design) that was the product through decisions D1–D25. The
pivot is economic, not technical: a real-numbers market-size check found
that revenue source too small to build a business on. That design is fully
preserved, unedited, in `legacy/` — see `legacy/README.md` — in case
auto-compounding becomes viable again later.

**Status:** the on-chain/off-chain architecture for the current direction is
not yet designed. What exists and works today is `scripts/` — a toolkit that
measures √k fee-accrual directly on-chain, mainnet-verified across Minswap
V2 and WingRiders V2. DraperU x Cardano Genesis Hacker House application
(July 2026).

## Layout

| Dir | What |
|---|---|
| `scripts/` | **Active.** `scripts/sqrtk/` — √k measurement toolkit: deep snapshots, a periodic weekly collector, pool enumeration. Python, stdlib only. Start with `scripts/sqrtk/SQRTK_RUNBOOK.md`. `scripts/dispersion/` — a standalone DefiLlama-derived cross-sectional read, not the gold-standard measurement |
| `legacy/` | The archived auto-compounding vault design — validator, executor scaffold, per-action workflow docs. Frozen, not maintained; see `legacy/README.md` before assuming anything in it is current |
| `reference/` | Vendored Minswap + WingRiders material: AMM V2 spec, formula.md, farm docs, SDK snapshots — still relevant, the current direction reads the same pools |
| `docs/` | Design decisions (`decisions.md`, one continuous history — never split when `legacy/` was carved out), the √k brief, parked ideas for the current direction |
| `web/` | Not started. Was planned as React + Vite + Mesh SDK for the old app; nothing built for either direction |

Nothing named `validators/` or `executor/` exists at the repo root right now
— both moved to `legacy/` whole. If you're looking for them expecting the
old app, start at `legacy/README.md`.

## Working today

```bash
cd scripts/sqrtk
python3 sqrtk_snapshot.py selftest && python3 mock_run.py && python3 mock_tick.py
```
All three offline, no key, no network — the mandatory pre-flight before
spending a single API call. Then `scripts/sqrtk/SQRTK_RUNBOOK.md` for the real
enumerate/measure/tick workflow against mainnet.

## Stack (for `scripts/`, the only thing currently built)

- **Python 3.9+, standard library only** — no `pip install`, nothing to
  audit for supply-chain risk.
- **Blockfrost** (mainnet) — the only external dependency.

Nothing has been decided yet about the eventual vault/executor/web stack for
the current direction. The old app's stack (Aiken, SpaceBudz Lucid,
@minswap/sdk, Mesh SDK) is documented in `legacy/README.md` as a reference
shape, not a current commitment — though D7's Lucid-flavor reasoning (SpaceBudz
Lucid, not Lucid Evolution, because @minswap/sdk is built on it) has no
reason to change if/when tx-building code gets written again.

## Full record

`docs/decisions.md` for the design history (including the pivot itself, D26).
`docs/workflows/README.md` for how the mechanism design is organized and
where each piece lives. `docs/v2-ideas.md` for parked features against the
current direction — `legacy/docs/v2-ideas.md` for the old app's.
