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

## Value path — return-to-vault is unconditional (policy, 2026-07-23)

farm position (entire) → executor address → `ExitFarm` (vault value += LP,
`farmed_lp` −= exact amount, `total_lp` unchanged) → vault-held LP; redemptions
then proceed normally. **The withdraw + ExitFarm pair is one unit** — "get it
home and make the ledger true" — regardless of what triggered the emergency:

1. **Ledger honesty:** until ExitFarm lands, the LP sits at the executor address
   with `farmed_lp` still counting it — fine as a bounded in-flight state, a lie
   if it persists (proof-of-reserves alarms; `liquid?` gates redemptions on
   vault-held LP).
2. **Custody quality:** the vault is validator-guarded; the executor address is
   a bare hot key (Tier-3, the worst zone). Every emergency reason makes you
   MORE risk-averse — never park the pool at the bare key.

Terminology: "return to vault" = the ExitFarm leg (unconditional).
"Re-stake" = going back into the farm — a separate, reason-dependent aftermath
decision that after an emergency usually does NOT happen (whatever caused the
emergency is the reason not to re-stake).

The trustless exit lands at the **executor key**, not user wallets — N5;
capped-capital + MPC (D18) remain the standing answer.

## Aftermath by trigger (decided after the LP is safe in the vault)

| Trigger | After return-to-vault |
|---|---|
| Sustained co-sign outage | stay unfarmed, service redemptions; note re-staking needs the API too — pool earns trading fees only until Minswap recovers |
| Farm exploit/compromise | stay unfarmed until audited / permanently — venue decision. (AMM-itself compromise is beyond this doc: LP tokens are the problem; wind-down/redeem-out territory) |
| Executor key incident | return-to-vault becomes a RACE — a compromised key can sweep the executor address or fire the withdraw itself. Defender's edge is preparation: withdraw + ExitFarm pre-built, submitted back-to-back. D18 capped capital is the real bound (a stolen key was always total-exposure in any design) |
| Venue wind-down | stay unfarmed → users redeem out, or v2 re-deploys via another venue's adapter |

## Open questions (design when this doc is written properly)

- Who authorizes and how (treasury signature? written runbook + threshold?).
- User comms/UI during the event.
- Accounting: pending emissions are forfeited — confirm nothing needs a
  RecordHarvest-style entry (expectation: no; datum totals never knew about them).
