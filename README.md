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

**Narrowed further (D27/D28, 2026-07-31):** vault custody is per-user
(individual), not pooled — see `docs/decisions.md` D27. v1 target is a
cross-DEX LP aggregator + one-click zap-in ("DexHunter for liquidity
positions") — pool discovery/comparison across DEXs with direct zap-in
execution — ahead of any managed-strategy automation (D28). √k stays the
fee-accrual measurement primitive but is one building block in a growing
strategy library now, not the whole product. Pooled vaults aren't
abandoned, just deferred — `docs/v2-ideas.md`.

This replaces a farm-emissions auto-compounding vault (Minswap V2, pooled
single-vault design) that was the product through decisions D1–D25. The
pivot is economic, not technical: a real-numbers market-size check found
that revenue source too small to build a business on. That design is fully
preserved, unedited, in `legacy/` — see `legacy/README.md` — in case
auto-compounding becomes viable again later.

**Status:** the on-chain/off-chain architecture for the current direction is
not yet designed. What exists and works today is `automation/sqrtk/` — a
toolkit that measures √k fee-accrual directly on-chain, mainnet-verified
across Minswap V2 and WingRiders V2. DraperU x Cardano Genesis Hacker House
application (July 2026).

## Layout

| Dir | What |
|---|---|
| `automation/` | **Active.** `automation/sqrtk/` — √k measurement toolkit: deep snapshots, a periodic collector, pool enumeration. Python, stdlib only. Start with `automation/sqrtk/SQRTK_RUNBOOK.md`. Moved out of `scripts/` so the whole data-refresh pipeline (Python measurement + Node ingest/refresh + the scheduling orchestrator) has one home, distinct from `web/`'s own app code |
| `scripts/` | `scripts/dispersion/` — a standalone DefiLlama-derived cross-sectional read, not the gold-standard measurement. (`scripts/sqrtk/` moved to `automation/sqrtk/`) |
| `legacy/` | The archived auto-compounding vault design — validator, executor scaffold, per-action workflow docs. Frozen, not maintained; see `legacy/README.md` before assuming anything in it is current |
| `reference/` | Vendored Minswap + WingRiders material: AMM V2 spec, formula.md, farm docs, SDK snapshots — still relevant, the current direction reads the same pools |
| `docs/` | Design decisions (`decisions.md`, one continuous history — never split when `legacy/` was carved out), the √k brief, parked ideas for the current direction |
| `web/` | Scaffolded (D29): Next.js + Tailwind/shadcn + TanStack. Pool comparison page now reads from a real Postgres DB (`current_readings`), fed by `automation/`'s pipeline — see `web/README.md` for the current data-flow state |

Nothing named `validators/` or `executor/` exists at the repo root right now
— both moved to `legacy/` whole. If you're looking for them expecting the
old app, start at `legacy/README.md`.

## Working today

```bash
cd automation/sqrtk
python3 selftest.py && python3 mock_wingriders.py && python3 mock_minswap.py \
  && python3 mock_enumerate.py && python3 mock_fetch_db.py
```
All five offline, no key, no network — the mandatory pre-flight before
spending a single API call. Then `automation/sqrtk/SQRTK_RUNBOOK.md` for the
real enumerate/fetch workflow against mainnet.

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
