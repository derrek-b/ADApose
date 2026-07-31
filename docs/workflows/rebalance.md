<!-- Source: none yet -- see docs/mechanism-sqrtk.md's own note. -->
# Workflow: Cross-pool rebalance

Extracted from `docs/adapose-sqrtk-vault-brief.md` §6 (2026-07-30) — see
`docs/workflows/README.md` for the full breakdown. Depends on
`docs/mechanism-sqrtk.md` (the `√k` invariant) and `docs/fee-crystallization.md`
(step 1 below is exactly that doc's crystallization rule, applied once more here).

**Status: design, not decision.** Same caveat as the two docs above.

**Why this workflow exists at all:** `√k` units are pool-specific
(`docs/mechanism-sqrtk.md`) — `√(NIGHT·USDCx)` and `√(USDM·ADA)` don't compare.
So moving the vault's capital between pools has to *close* the accrual
measurement in the old pool's units before the LP is touched, then re-open a
fresh baseline in the new pool's units once the vault is back in a position. The
final step is a **re-basing, not a crystallization — it charges nothing**, which
is the detail that makes the whole protocol not double-charge on the move
itself.

## The protocol

1. **Crystallize** in the old pool's units, per `docs/fee-crystallization.md`.
   Mint fee shares. Supply is now frozen — nothing mints or burns again until
   the vault is back in an LP position.
2. **Burn the LP.** Receive proportional reserves. Value-neutral in the fee
   basis: `√(tokens received)` equals the vault `√k` just measured. No fee event
   belongs here.
3. **Swap into the new pair.** The only step that destroys value. If the
   destination pool shares a leg with the origin, swap only the leg that
   changed.
4. **Zap in, read the new LP balance.**
   `vault √k_new = LP_vault_new × (√k_new ÷ LP_total_new)`.
5. **Re-base:** `HWM = vault √k_new ÷ supply`. Supply never moved during steps
   2–4, so this is fully determined — no fee event, no crystallization math,
   just recording where the new baseline sits.

## The governance problem this creates

The round trip destroys real value — swap fees, price impact, and batcher fees,
which exist on every venue **including Minswap** (✅ confirmed on-chain: 2 ADA
flat per order, `used_batcher_fee > 0` is a hard requirement — see
`docs/adapose-sqrtk-vault-brief.md`'s correction note, this was gotten wrong
once already and shouldn't be re-assumed as zero). The swap-fee/price-impact
piece alone was estimated at ~0.4% in the brief's worked example (below);
batcher fees are a separate, additive, per-order fixed cost on top of that — a
Minswap rebalance is at minimum three separate orders (withdraw, swap, deposit),
so ~6 ADA fixed, before whatever the destination venue's own fee structure adds.

**Because the HWM re-bases *below* where it was, the operator never has to earn
that loss back before the fee resumes.** Churn the vault and holders bleed while
the operator clips every recovery on the way back up. The fee at each individual
step is honestly computed — the harm is entirely in how often the whole cycle
repeats. **Nothing in the fee math prevents this. It has to be constrained in
the validator**, which is what the guardrails below are for.

## Guardrails (all oracle-free, all on-chain checkable)

- **Cooldown.** Minimum slot gap between rebalances, enforced in the validator,
  not in executor code. This is the guardrail that actually binds — everything
  else here is a check on a single rebalance's *shape*; this is the only one
  that limits *frequency* directly.
- **Per-swap slippage bound.** For a constant-product swap, compare the executed
  rate against the pool's own reserve ratio inside the transaction — no external
  price needed, the pool prices itself. Reject anything worse than ~50 bps.
  Kills the version where the operator routes through a thin pool it controls
  the other side of.
- **Pool whitelist with a depth floor**, so the destination can't be a pool
  where the vault would be most of the liquidity — ties into
  `docs/mechanism-sqrtk.md`'s validator-hash whitelist, same mechanism, an
  additional condition on it.
- **Payback rule.** Don't rebalance unless the projected yield differential
  recovers the round-trip cost within N days; set the cooldown so a rebalance
  can't repeat inside its own payback window. Ties frequency to economics
  rather than an arbitrary constant.
- **Operator share lockup.** Fee shares are a real position in the vault, so the
  operator eats its pro-rata slice of every rebalance loss — but that's a small
  fraction of the total harm early on, and only bites if the shares aren't
  immediately redeemed. A lockup or vesting schedule on operator fee shares
  forces a standing position that grows with tenure, raising the operator's own
  stake in not churning.

## Mid-flight state

Steps 2–4 are three or more batcher orders landing in different blocks. In
between, the vault holds loose tokens and has **no `√k` at all** — a deposit or
withdrawal arriving in that window has nothing to price against. Two options:

- **Freeze mints and burns, flag the vault "rebalancing."** Simpler; means a
  user can be locked out for the duration, which belongs in user-facing
  disclosure and argues for a generous cooldown (so the frozen window is rare
  and short relative to normal operation).
- **Let a redeemer take a pro-rata slice of the loose tokens in-kind.** Still
  well-defined — it's just proportional — but more code, and needs its own
  correctness argument for the in-between state.

**Starting assumption is the freeze**, not yet a locked decision.

## Worked example (continues from `docs/fee-crystallization.md`'s worked section)

Picks up after the crystallized deposit (`√k per share = 1.047749`, supply
`1,006.91959`), with another 5% accruing before a rebalance from NIGHT/USDCx to
USDM/ADA:

```
√k per LP     1.102500
vault √k      1,004.761905 × 1.102500 = 1,107.750
√k per share  1,107.750 ÷ 1,006.91959 = 1.100139
HWM           1.047749
```

**Step 1 — crystallize:**

```
gain/share    0.052390
total gain    52.752 √k
fee @ 4.5%    2.3738 √k
solve         s = 2.16233
supply        1,009.08192          ← frozen from here until back in LP
√k per share  1,107.750 ÷ 1,009.08192 = 1.097780
```

**Step 2 — burn LP:**

Vault fraction = `1,004.761905 ÷ 101,004.761905 = 0.994766%`. Reserves
`1,113,577.5 / 11,135.775`, so the vault receives **11,077.5 NIGHT + 110.775
USDCx**.

`√(11,077.5 × 110.775) = 1,107.75` — the loose tokens carry exactly the vault
`√k` just measured.

**Step 3 — swap into USDM + ADA.** The only lossy step.

**Step 4 — zap in:**

```
√k_new           1,414,214
LP_total_new     250,000
√k per LP        5.656854          ← nothing like 1.1025; different unit entirely
LP_vault_new     195.0             (what the zap returned)
vault √k_new     1,103.087
```

**Step 5 — re-base, no fee:**

```
HWM = 1,103.087 ÷ 1,009.08192 = 1.093155
```

Read the last two `√k per share` figures together: **1.097780 → 1.093155**. The
round trip cost holders **0.42%**, borne entirely by them, and the HWM re-bases
below where it was. That 0.42% is exactly what the guardrails above exist to
constrain the *frequency* of, since the per-rebalance cost itself is honestly
computed and can't be argued away — only how often it repeats can.

## Open design points

1. **v1 venue scope for rebalancing specifically (brief Q13).** If multi-venue
   support turns out expensive across the board (`docs/mechanism-sqrtk.md`'s own
   open points), does rebalancing specifically need two venues from day one to
   exercise the cross-venue re-basing logic before it's load-bearing, or is
   Minswap-only (no real rebalance target, just the mechanism proven on paper)
   an acceptable v1? Rebalancing is the one workflow whose entire point is
   moving *between* venues, so scoping it to one venue is a different kind of
   compromise than scoping deposit/redeem to one venue.
2. **Mid-flight freeze vs. pro-rata, decided for real.** The brief's own
   "starting assumption" was the freeze, not a decision — needs one, including
   what the user-facing disclosure says about lockout duration expectations.
3. **Guardrail parameter values.** Cooldown length, the ~50bps slippage bound,
   whitelist depth floor, payback-rule N days, lockup duration — all named as
   mechanisms above with no numbers attached yet, same shape as `legacy/`'s own
   `T_max`/`DEADLINE_MARGIN` having been mechanism-first, numbers-later.
4. **Is the slippage bound actually checkable on-chain (brief Q4).** The
   guardrail above assumes a validator can compare the executed swap rate
   against the pool's own reserve ratio inside the transaction — but that
   assumes the executed rate is even visible to the validator at validation
   time. Does the batcher-fill model make it unavailable there, the way batcher
   latency already complicates deposit's two-phase question
   (`docs/workflows/deposit.md`)? If the rate isn't checkable directly, the
   guardrail needs a different enforcement point (e.g. checked against the
   post-fill UTxO's own value instead of the swap's stated terms).
