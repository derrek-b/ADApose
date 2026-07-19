<!-- Source: validators/validators/vault.ak -->
# Workflow: Emergency Withdraw (STUB — accumulated notes only)

**Status: not yet designed.** Collects scope/trigger facts discovered while writing
the other workflow docs so they land here, not in breadcrumbs. Full step-by-step TBD.

**Decisions feeding this doc:** D19 (`EMERGENCY_WITHDRAW` = farm redeemer
constructor 3, owner-sig-only, no co-sign), D18 (custody envelope), D20 addendum
2026-07-19 (`ExitFarm` — the on-chain re-entry leg this path depends on).

## What it is

Trustless exit of the **entire** executor-keyed farm position — buildable by us
alone, no Minswap co-sign (D19; ⚠️ the one claim still resting on their word + our
decode — mainnet dust test on week1-verify, item b). All-or-nothing by
construction: no partial emergency exit exists. Forfeits **all pending
(unharvested) emissions** for the position.

## Triggers (policy — accumulated 2026-07-19)

- **Admin/extraordinary only.** No user action, redeem order, or queue depth fires
  it automatically — users hold Cancel and a redemption claim, never this trigger.
- **Named escalation rung (from redeem.md Step C, tier 3):** sustained
  co-sign-API outage with redemptions queued → treasury-authorized emergency
  withdraw → `ExitFarm` → service the queue. Naming this rung is what makes the
  buffer-miss co-sign dependency an honest *delay* risk instead of a potential
  permanent lockup.
- Other qualifying circumstances TBD when this doc is written (candidates:
  Minswap farm exploit/compromise, executor key incident, venue wind-down).

## Value path

farm position (entire) → executor address → `ExitFarm` (vault value += LP,
`farmed_lp` −= exact amount, `total_lp` unchanged) → vault-held LP; redemptions
then proceed normally. The trustless exit lands at the **executor key**, not user
wallets — N5; capped-capital + MPC (D18) remain the standing answer.

## Open questions (design when this doc is written properly)

- Who authorizes and how (treasury signature? written runbook + threshold?).
- Aftermath: criteria for re-staking vs. staying unfarmed vs. winding down the
  venue; user comms/UI during the event.
- Accounting: pending emissions are forfeited — confirm nothing needs a
  RecordHarvest-style entry (expectation: no; datum totals never knew about them).
