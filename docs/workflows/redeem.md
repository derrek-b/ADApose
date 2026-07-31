<!-- Source: none yet -- see docs/mechanism-sqrtk.md's own note. -->
# Workflow: User Redemption

**Stub, thinner than `deposit.md`.** The brief covers almost nothing
redeem-specific — the one relevant piece is a principle, not a mechanism, and
it already lives in `docs/mechanism-sqrtk.md`'s "Non-custodial constraints"
section: **in-kind redemption** — redeemers receive a pro-rata slice of the LP
(or underlying), never a valuation, which is what makes the design structurally
immune to a pump-the-pool-then-redeem-at-inflated-NAV attack (no pricing occurs
anywhere in the redemption path at all). That's the whole of what's designed so
far.

Everything else — the actual burn/payout transaction shape, whether redemption
rides an order queue the way `legacy/`'s redeem.md did, how a redemption
interacts with a vault mid-rebalance (`docs/workflows/rebalance.md`'s mid-flight
freeze would presumably block redemption too, but this hasn't been stated
explicitly from the redeem side) — is undesigned. No open-design-points list
yet either, because the workflow hasn't been designed far enough to know what's
actually in question versus simply missing.
