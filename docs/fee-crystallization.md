<!-- Source: none yet -- see docs/mechanism-sqrtk.md's own note. -->
# Fee mechanism: vault-level high-water mark, crystallized on every supply change

Extracted from `docs/adapose-sqrtk-vault-brief.md` §5 (2026-07-30) — see
`docs/workflows/README.md` for the full breakdown. Depends on
`docs/mechanism-sqrtk.md` (the `√k` invariant and vault-state model) and feeds
`docs/workflows/rebalance.md` (crystallization is step 1 of every rebalance).

**Status: design, not decision.** Same caveat as `mechanism-sqrtk.md` — nothing
here is a validator yet.

**Update (2026-07-31, D27 in `docs/decisions.md`):** this doc's entire
"crystallize on every supply change" design exists to solve a fairness
problem specific to pooled, fungible-share vaults (multiple holders, no
per-user cost basis — see "The problem this solves" below). The current
direction uses individual (one-owner) vaults instead, where that fairness
problem doesn't exist: crystallization only needs to happen at withdrawal or
cross-pool rebalance, not on every deposit, and a same-pool top-up can blend
cost basis instead of forcing a fee-realization event. This dissolves Open
design points 2 (the dust vector) and 3 (contention cost) below outright —
both existed only to defend a multi-holder fairness problem that no longer
applies. This doc needs a rewrite pass to reflect the simpler individual-vault
model; not yet done — read D27 before trusting the mechanism below as
current for the vault actually being built.

## The problem this solves

Shares are fungible CIP-68 tokens and therefore transferable, so the contract
cannot know any holder's cost basis — no per-user accounting, no equalization
credits available. The HWM has to live on the vault, shared across every holder.

That creates a fairness problem on its own: a holder who mints above the HWM
would get billed for growth that happened before they arrived, if fees were only
crystallized periodically.

## The fix — crystallize on every supply change, unconditionally

Deposit, withdrawal, doesn't matter. One rule, one code path, no thresholds:

```
gain per share   = (current √k per share) − HWM
total gain       = gain per share × supply
fee              = fee_rate × total gain
```

Fees are collected by **minting shares to the operator**, not by moving assets.
Solve for `s`:

```
s ÷ (supply + s) × (vault √k) = fee
```

Then reset HWM to the post-mint `√k per share` — slightly below the pre-mint
figure, since the mint itself dilutes. Worked exactly in the "User 2 deposits"
section below.

## Why unconditional crystallization is safe and free here

- **Collection is a mint folded into a transaction that was already
  happening.** No swap, no batcher order, no exit. Marginal cost ≈ 0. (If fee
  collection ever changes to ADA instead of shares, this inverts and thresholds
  would be needed — noted here so nobody "optimizes" this into a threshold model
  without re-deriving why it currently doesn't need one.)
- **Within one pool, `√k per share` never falls.** `k` only grows; deposits and
  withdrawals move `LP_vault` and supply together, so they don't move the ratio.
  The only thing that reduces `√k per share` is the fee mint itself. So
  ratcheting the HWM up costs holders nothing — there's no drawdown a lower HWM
  would have let them net against. **The usual objection to frequent
  crystallization (it forfeits future drawdown protection) doesn't apply to this
  basis** — worth stating explicitly since it's the kind of thing a reviewer
  familiar with traditional HWM fee structures will reflexively push back on,
  and the pushback doesn't hold here specifically because of the
  never-falls-within-a-pool property above.

Crossing pools (rebalancing) is the one case this doesn't cover — `√k` units are
pool-specific, so a rebalance needs its own crystallize-then-rebase treatment,
covered in `docs/workflows/rebalance.md`, not here.

## Worked example (continues from `docs/mechanism-sqrtk.md`'s worked section)

Picks up after "Fees accrue, nobody deposits" (√k per share = 1.050000, HWM =
1.000000) and "User 2 deposits 100 NIGHT, single-sided":

First, crystallize, because supply is about to change:

```
gain/share    1.050000 − 1.000000 = 0.050000
total gain    50.000 √k
fee @ 4.5%    2.250 √k
solve         s ÷ (1,000 + s) × 1,050 = 2.25  →  s = 2.14743
supply        1,002.14743
√k per share  1,050 ÷ 1,002.14743 = 1.047749
HWM reset     1.047749                          ← not 1.0500; the mint dilutes
```

Check: operator holds `2.14743 × 1.047749 = 2.2500 √k`. Correct.

Then mint (the actual deposit, per `docs/mechanism-sqrtk.md`'s share-issuance
formula):

```
LP received   4.761905
LP_vault      1,004.761905
LP_total      101,004.761905
reserves      1,060,550 / 10,605.5
√k            106,055
√k per LP     106,055 ÷ 101,004.761905 = 1.050000    ← still unchanged
vault √k      1,004.761905 × 1.050000 = 1,055.000
Δ vault √k    5.000
shares minted 5.000 ÷ 1.047749 = 4.77216
supply        1,006.91959
user 2 owns   4.77216 ÷ 1,006.91959 = 0.473936%
```

Cross-check against the reserve method: user 1's 1,000 LP is 0.990099% of the
pool = 10,500 NIGHT + 105 USDCx = 21,000 NIGHT of value. User 2 contributed 100.
`100 ÷ 21,100 = 0.473934%`. Matches to rounding.

## Open design points

1. **Rounding direction for fee shares.** Round in favour of existing holders
   (never the operator) — matches this project's own established house-favored
   rounding discipline (`legacy/`'s N3, though this isn't that invariant
   specifically — the *principle* of "round against whoever's collecting" should
   carry over regardless of which architecture).
2. **The dust vector.** A deposit small enough to mint zero fee shares — reject
   it outright, or accept it with the HWM left untouched? The second option is
   the trap: a stream of sub-rounding deposits could each escape crystallization
   entirely, letting real accrued gain slip through fee collection incrementally.
   Needs a decision, not a default.
3. **Contention cost of crystallizing on every change (brief Q6).** Does
   crystallizing on *every* supply change make the single-vault-UTxO contention
   problem (concurrent deposits conflicting in the same block) materially worse?
   If so, is a threshold worth the fairness cost after all, given the "unconditional
   crystallization is free" argument above was about marginal *compute* cost, not
   about contention/throughput cost, which is a different axis entirely.
