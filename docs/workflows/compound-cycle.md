<!-- Source: validators/validators/vault.ak -->
# Workflow: Compound Cycle (STUB — accumulated notes only)

**Status: not yet designed** (deferred by choice — the biggest doc; user-paced).
Collects facts and constraints discovered while writing the other workflow docs
so nothing waits in breadcrumbs. Full step-by-step TBD.

**Decisions feeding this doc:** D3 (trigger, weekly cap), D19 (API mutations +
verifier), D20 (RecordHarvest + fee design), D21 addenda (harvest-priority,
precedence order), D20 addendum 2026-07-23 (farmed_lp semantics).

## Accumulated facts & constraints (so far)

1. **Fee-mint bound (surfaced by proof-of-reserves C5, 2026-07-23):** the
   RecordHarvest treasury mint `t` must provably satisfy
   **`t ≤ floor(ΔLP × total_shares / total_lp)`** — the rate-non-decrease line.
   At fee_bps = 4.5% of the gain, `t ≈ 0.045 × ΔLP·S/L`, ~22× below the line —
   but this is THE inequality a fee-math bug would cross, so it should be a
   named validator check (rides with the `n1_`/mint-gate family), and
   proof-of-reserves C5 (rate monotonicity) is the live alarm behind it.
2. **Harvest is multi-pool single-tx first-class** (`buildMultipleHarvestsV2`,
   own input shape — ✅ vendored doc) — irrelevant at one pool, free
   scale-lever later.
3. **RecordHarvest enforcement proposal** (week1-verify): farm position UTXO as
   reference input; validator sets `farmed_lp := referenced position LP`;
   treasury mint = fee_bps × increase. Verify referenceability at dust time
   (item (f)).
4. **Sequencing:** RecordHarvest holds the top of the vault-spend precedence
   order (D21 addendum 2026-07-23); harvest-priority anti-JIT-snipe rationale.
5. **Cycle shape (D19/D20):** API harvest → MIN→pair swap order(s) → add-liq
   order → API stake → RecordHarvest. Steps 1–4 live entirely in executor
   custody (zone 4 / executor address); only RecordHarvest touches the vault,
   and it moves ledger numbers, not value (value-flow.md trace).
6. **Trigger (D3, restated D20):** pool-level, aggregate accrued rewards ≥ 2×
   cycle cost, weekly max cadence. Pending-rewards readability = dust item (d).
7. **Swap slippage floor:** D12's on-chain floor parameter applies to OUR swap
   orders in the cycle (min_receive vs spot — week1-verify D12 items).
