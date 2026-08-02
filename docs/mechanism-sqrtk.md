<!-- Source: none yet -- no validator exists for this. This doc IS the design
     that a future validator would be written against. -->
# Mechanism: √k fee-accrual measurement, vault state, share issuance

Extracted from `docs/adapose-sqrtk-vault-brief.md` §2, §3, §4, §7 (2026-07-30) as
that document gets broken into per-concern docs — see `docs/workflows/README.md`
for the full breakdown and why. This is the foundational doc: fee crystallization
(`docs/fee-crystallization.md`) and rebalancing (`docs/workflows/rebalance.md`)
both depend on the invariant and vault-state model defined here.

**Status: design, not decision.** Nothing here is a validator yet. Treat every
claim as "this is the plan," not "this is built" — the brief's own Status line
called the economics "still being worked," and that's still true of the mechanism
details below, not just the numbers.

**Update (2026-07-31, D27 in `docs/decisions.md`):** the vault topology this
doc assumed — a shared vault per pool with fungible shares — is superseded.
The current direction uses one vault per user (individual custody), not
pooled. The invariant itself (this doc's core: the `√k` measurement, its
non-decreasing property, what the vault reads on-chain) survives unchanged
and custody-agnostic — that part isn't stale. The **"Share issuance"**
section below specifically is pooled-only bookkeeping (mint/burn math for
many holders sharing one position) that doesn't apply once there's exactly
one owner with nothing to mint against. This doc needs a rewrite pass to
make that split explicit; not yet done — read D27 before trusting the Share
issuance section as current for the vault actually being built.

## The invariant

For a constant-product pool with reserves `x` and `y`:

```
k = x · y
```

A swap holds `k` constant by construction — the trader puts in `Δx` and takes out
exactly enough `Δy` to leave the product unchanged. Trading fees are *added to the
reserves without being part of the trade*, so:

**`k` only ever increases, and only from fees.**

That makes `√k` a fee-accrual meter. It scales linearly with pool size (double both
reserves and `k` goes ×4, `√k` goes ×2), so it behaves like a quantity, not a
square.

Two properties matter:

1. **Manipulation-proof.** No swap can move `k` — not a flash loan, not a whale
   trade, not a wash trade by us. This is the core reason to use `√k` rather than
   a price or a TVL figure.
2. **Strips out market beta.** An LP position's value is proportional to
   `√k × √p`, where `p` is the paired asset's price. Charging on `√k` charges on
   accrual only, not on whether the token went up.

**Consequence: `√k` units are pool-specific.** `√(NIGHT · USDCx)` and
`√(USDM · ADA)` are not the same unit and there is no conversion between them —
this is what forces the rebalance protocol (`docs/workflows/rebalance.md`) to
crystallize before touching the LP, never after.

## Where the invariant is and isn't valid

`k = x·y` is the constant-product invariant specifically — not a general AMM
property, and "Cardano DEXs are constant-product" is true of the venues but
**not of every pool at those venues**. The pool whitelist has to be built on
**validator hashes, not venue names.**

Splash is the sharpest case: it runs five pool families, and only two have a valid
invariant here.

| Splash pool family | Invariant | `√k` valid? |
|---|---|---|
| `ConstFnPool*` | `x · y = k` | **Yes** |
| `BalanceFnPool` | weighted, hardcoded 1:4 → `x · y⁴` | No |
| `StableFnPoolT2T` | stableswap | No |
| `DegenQuadraticPool` | quadratic bonding curve | No |
| `RoyaltyPool` | CPMM plus a third royalty fee stream | Yes for the invariant, royalty stream needs separate handling |

WingRiders and Minswap both run stableswap pools alongside constant-product ones
too, and SundaeSwap's stableswap pools carry a `protocolFeeBasisPoints` removed
from reserves. **Whitelist by validator hash, verify the invariant per pool type,
reject anything not on the list** — this is a hard requirement, not a nice-to-have,
given how silently wrong a mismatched pool type would read (see the reserve-source
trap below).

## What the vault reads on-chain

The vault never computes "its share of the pool" from token amounts — it reads LP
tokens:

```
√k per LP token  =  √(x · y) ÷ LP_total
vault √k         =  LP_vault × (√k per LP token)
```

`√k per LP token` rises **only** from trading fees — unchanged by anyone
depositing or withdrawing, ours or an outsider's. **That invariant is the
correctness check on the whole design** — if an implementation ever shows the
vault's `√k` moving because a third party added liquidity, the math is wrong,
full stop, same discipline `legacy/`'s own non-decreasing check enforced.

This dissolves two problems that look hard:
- **Single-sided / zap-in deposits.** No need to know how the zap split the
  deposit or what slippage it took — read the vault's LP balance before and
  after, the delta is the answer, slippage is already baked in.
- **Accrual between deposits.** Nothing to track. LP balance sits still, `k`
  grows, `√k per LP` rises.

**⚠️ UNVERIFIED — which reserves, though.** `x` and `y` must be the reserves the
invariant is actually computed over, and venues differ on where those live.
Minswap V2 parks the accrued treasury cut *inside* the pool UTxO while excluding
it from the datum reserves — UTxO value ≠ datum reserves, only the datum figure
belongs in `k`. WingRiders and Splash subtract the treasury cut from reserves
directly. **Reading the wrong one makes `√k per LP` appear to move for reasons
that aren't fees, silently breaking the correctness check above.** This is the
single most important per-venue detail (brief §9 Q4b) and needs confirming per
venue before that venue's pools are trusted, the same discipline
`automation/sqrtk/SQRTK_RUNBOOK.md` section 6 already applies to its own venue
`Venue.verified` flags — this mechanism needs the on-chain equivalent of that
same discovery step.

**Persistent vault state is two values:** the high-water mark (`√k per share` at
last crystallization — `docs/fee-crystallization.md`) and the current pool
identifier. Share supply is readable directly from the CIP-68 token's on-chain
supply, not tracked separately.

## Share issuance

```
shares minted = Δ(vault √k) ÷ (√k per share)
```

First entrant sets `√k per share ≡ 1.0`. Worked numerically in the "Starting
pool" through "User 2 deposits" sections below.

## Non-custodial constraints (draft — not yet a locked invariant set)

**Not a decisions.md D-entry yet.** These are proposed, the way D20-N was before
it graduated from design work into a decided, named invariant set with its own
validator checks and tests. Treat this section as "the target," not "the
guarantee," until that graduation happens.

- **No validator-accepted transaction may produce an output to the executor's
  address.** Every output goes back to the vault script, or to a whitelisted
  pool's order script naming the vault script as receiver. The executor is a
  **signer, never an owner.**
- **Unilateral exit.** A share-burn redemption redeemer any holder can invoke on
  their own signature, without operator cooperation.
- **In-kind redemption.** Redeemers receive a pro-rata slice of the LP (or
  underlying), never a valuation — structurally immune to a
  pump-the-pool-then-redeem-at-inflated-NAV attack, because no pricing occurs
  anywhere in the redemption path.
- **Rebalance costs funded from the executor's own wallet**, not vault assets —
  keeps the vault's `√k` reduction attributable purely to swap fees and slippage,
  and makes the operator's cost real rather than nominal.

**Why there's no oracle anywhere in this design:** validators have no internet. A
USD or CoinGecko price can only enter by someone signing it in, and if that
someone is the operator, the operator is attesting its own fee basis. Numéraire
is ADA on-chain; USD is display only.

If this graduates into a real invariant set, it's a materially stronger custody
posture than `legacy/`'s N5 ("custody honesty" — disclosed dependence on executor
liveness) — worth being precise that this is a *design target*, not yet something
verified the way D19's emergency-withdraw trustlessness was mainnet-confirmed.

## Worked example

Illustrative numbers throughout — pool state, LP totals, and zap outputs are
invented, the arithmetic between them is exact. Continues into
`docs/fee-crystallization.md`'s own worked section (the "User 2 deposits"
crystallization) and `docs/workflows/rebalance.md`'s (the rebalance walkthrough).

### Starting pool (NIGHT/USDCx)

```
reserves      1,000,000 NIGHT / 10,000 USDCx
k             10,000,000,000
√k            100,000
LP_total      100,000
√k per LP     1.000000
```

### User 1 deposits 100 ₳ (zapped to 10,000 NIGHT + 100 USDCx)

```
LP received   1,000
LP_total      101,000
reserves      1,010,000 / 10,100
√k            101,000
√k per LP     101,000 ÷ 101,000 = 1.000000     ← unchanged; deposits never move it
vault √k      1,000 × 1.000000 = 1,000
Δ vault √k    1,000
mint          1,000 shares   (first entrant pegs √k per share ≡ 1.0)
HWM           1.000000
```

### Fees accrue, nobody deposits (k +10.25%, so √k +5%)

```
reserves      1,060,500 / 10,605
√k            106,050
LP_total      101,000                          ← unchanged
√k per LP     1.050000
vault √k      1,050
√k per share  1.050000                          (+5% over HWM)
```

Nothing was tracked. Accrual is free.

### Correctness check — an outsider doubles the pool

```
√k            212,100
LP_total      202,000
√k per LP     212,100 ÷ 202,000 = 1.050000     ← identical
vault √k      1,050                             ← identical
```

Outside liquidity cancels exactly. *(Continues from the pre-doubling state in
`docs/fee-crystallization.md`'s worked section.)*

## Open design points

1. **Reference input reads for pool state (brief Q1).** Can the Minswap pool
   UTxO be used as a reference input so the validator reads `x`, `y`, and LP
   supply directly at validation time? If not, how does the vault establish
   `√k per LP` on-chain without trusting the executor's assertion?
2. **Circulating LP supply on Minswap (brief Q2).** Minswap holds unissued LP
   inside the pool UTxO, so the LP asset's total supply is not "LP in
   circulation." Does the pool datum carry the figure needed, matching how
   `automation/sqrtk/sqrtk_core.py`'s `pool_holds_remainder` venue rule already
   reads this off-chain (`max_lp_supply − held`) — can a validator do the same,
   and is `max_lp_supply` confirmable the same way `automation/sqrtk/`'s own
   `Venue` config confirmed it on-chain?
3. **Per-venue reserve source, extending the ⚠️ flagged above (brief Q4b).**
   Datum reserves vs. UTxO value, confirmed per venue before that venue's pools
   are trusted — the single most consequential open point in this whole doc.
4. **Multi-venue abstraction shape (brief Q4a).** One validator with a per-venue
   adapter, a pool-type tag in the whitelist entry, or one validator per venue?
   What does each option cost in scope?
5. **Whitelist enforcement mechanics (brief Q4c).** Can the whitelist be keyed on
   validator hash such that a pool of the wrong family (or the wrong invariant)
   is unspendable by the vault regardless of what the executor submits?
6. **SundaeSwap directional/decaying fees (brief Q4d).** `bid_fees_per_10_thousand`
   / `ask_fees_per_10_thousand` with decay — does asymmetric or decaying fee
   configuration affect the `k`-only-grows property at all, or is it invariant to
   how the fee was set? Needs checking, not assumed either way.
7. **"No output to the executor address," expressibility (brief Q7).** Cleanly
   expressible and auditable in the validator, given rebalance transactions must
   send outputs to a DEX's own order scripts?
8. **CIP-68 mint/burn binding (brief Q8).** How is the share token's mint/burn
   policy bound to the vault validator so shares can only be created or destroyed
   by a transaction that also satisfies the crystallization rule
   (`docs/fee-crystallization.md`)?
9. **Datum sizing (brief Q9).** HWM, pool identifier, in-flight flag, cooldown
   timestamp — any concerns at the sizes involved?
10. **Rounding and precision (brief Q10).** Where do the fixed-point decisions
    live, and what's the right precision for `√k` given the size range of
    Cardano pools?
