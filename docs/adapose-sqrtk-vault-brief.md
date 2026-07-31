# ADApose — √k Allocation Vault: Design Brief for Technical Review

**Status:** exploratory. The economics are still being worked. Nothing here is committed, and the numbers in the appendix are illustrative, not calibrated. The purpose of this document is to get an implementation opinion on the mechanism before we spend more time on the model.

**What we want back:** a read on whether this is buildable on Minswap as described, where it breaks, and roughly what it costs relative to the architecture we've already been working on. Specific questions are in Section 9.

**Revision note (29 Jul 2026):** Sections 1, 2, 7, 8 and 9 have been updated following a documentation review of all four major Cardano DEXs. The material changes are: the mechanism is venue-agnostic and the target is no longer Minswap-only (§1); Splash runs several *non*-constant-product pool families that √k does not apply to (§2); and Minswap's batcher fee has been zero since May 2025, which substantially weakens the cost-amortization argument (§7, §8).

**Correction (30 Jul 2026):** The 29 Jul revision's "Minswap's batcher fee has been zero since May 2025" claim is wrong, checked directly against the production validator source (`minswap-dex-v2`, `order_validation.ak`, function `validate_order_output_except_value`): `used_batcher_fee > 0` is a hard on-chain requirement on every order — a zero-fee order cannot fill, full stop, on any order type. The batcher fee is **2 ADA flat**, matching what this project's own `decisions.md` D5 already established and never revised. Most likely source of the error: Minswap subsidizing the fee for users on their own official front-end (a real, marketable "fee-free" UX layer) conflated with the protocol's actual on-chain requirement, which a third-party-built order is not exempt from. §6 and §8 below are corrected for the number itself; §8's cost-amortization *conclusion*, which was built on the wrong premise, is flagged rather than silently re-derived — that's real analysis someone should own deliberately, not patch inline.

---

## 1. Why we're looking at this at all

The existing design charges a performance fee on harvested farm emissions. We now have the number for how big that market is on Minswap, and it is very small.

```
Total MIN daily emission          90,385 MIN        (Minswap yield dashboard)
Annualized                        32,990,525 MIN
MIN price                         $0.002901         (CoinGecko, 28 Jul 2026)
Total emission value              ~$95,700 / year   ← this is the entire chain-wide pot
Total locked liquidity            36.24M ₳ ≈ $6.06M
Liquidity-weighted emission yield 1.58%
```

A 4.5% performance fee on **100% of every MIN emission on Minswap** is about **$4,300/year**. At a MIN price of $0.06 it's $89K. At a realistic capture rate it's a few hundred dollars. Fee revenue works out to 4.5% × 1.58% = **0.07% of AUM**, which puts breakeven on a ~$56K cost base somewhere north of $80M AUM against a total Cardano DeFi TVL of roughly $62M.

Farm emissions on Minswap are not a market. That is the finding driving everything below.

**Where the money actually is:** Minswap's own fee line is roughly **$2.29M annualized on $11.84M TVL** (DefiLlama, 28 Jul 2026) — trading fees, more than 20× the size of the emissions pot.

**Why we can't just harvest that:** on a constant-product (V2-style) AMM, trading fees are added directly into the pool reserves. There is no claimable balance. Nothing to harvest, so a harvest-based fee cannot reach them. This is exactly why Beefy built CLM and charges 9.5% on it — on concentrated-liquidity AMMs, fees accumulate as a separately-collectable amount, and their docs are explicit that CLM charges on "all trading fees claimed by the position." That playbook does not port to Cardano, because Cardano DEXs are constant-product.

So the question this design answers is: **how do you charge a performance fee that reaches trading fees on a constant-product AMM, without an oracle?**

### This is not a Minswap-only design

The emissions-based fee locked us to venues with a farm program, which in practice meant Minswap. A √k fee needs no farm program, no reward token, and no harvest — only a constant-product pool. That opens all four major Cardano DEXs, and the implementation should not assume Minswap anywhere it doesn't have to.

Documented fee structure per venue, from source rather than from DefiLlama's derived lines:

| Venue | Swap fee | LP / treasury split | Protocol take | Cut removed from reserves? |
|---|---|---|---|---|
| Minswap V1 | 30 bps (hardcoded, 997/1000) | 25 / 5 at the 1/6 default | 16.66% (default) | Yes — held in the pool UTxO but excluded from datum reserves |
| Minswap V2 | 5–2000 bps, per pool | fee sharing 16.66%–50%, **OFF by default** | 0%–50% | Yes, when enabled |
| WingRiders (CPMM) | 35 bps | 30 / 5 | 14.29% | Yes |
| WingRiders (stable) | 6 bps | 5 / 1 | 16.67% | Yes |
| SundaeSwap V3 (CPMM) | per pool, ~5/30/100 bps tiers | **30 / 0** | **none** | N/A — protocol revenue is a flat ADA scooper fee in a segregated `protocol_fees` field |
| Splash (ConstFnPool) | per pool, feeDen 100000 | ~90 / 10 per docs | ~10% | Yes |

Two things follow.

**The protocol take on Cardano is small — the LP side is 85–100% of the gross fee.** That is the favourable case for √k, because the LP-side accrual *is* our fee base. It is also materially higher than DefiLlama's Revenue lines imply; those lines are unreliable per venue (SundaeSwap's volume adapter has a confirmed bug since 2026-05-20; WingRiders has no Revenue adapter at all and folds batcher fees into Fees; Splash's Revenue is hardcoded at Fees × 0.5%, roughly 20× below what the docs describe).

**Every split is per-pool mutable.** Minswap V2 fee sharing is settable 16.66%–50% and defaults off; WingRiders exposes `projectFeeInBasis` / `reserveFeeInBasis` behind a fee-authority token; SundaeSwap V3 carries directional `bid_fees_per_10_thousand` / `ask_fees_per_10_thousand` with decay; Splash's treasury fee is a pool datum field. **The vault must never hardcode a fee rate or assume a split.** This is fine for the mechanism — √k measures realised accrual and doesn't care what rate produced it — but it matters for the pool whitelist and for anything that projects yield (the payback rule, now in `docs/workflows/rebalance.md`).

**Structure note (30 Jul 2026):** this document was always a bridge — a way to
carry the √k proposal from first draft to technical review, not the permanent
design record. As each piece gets properly designed out it moves to its own doc
and is removed from here; see `docs/workflows/README.md` for where everything
is going and why. What's left below (§1, §8, and a trimmed §9) is what's still
genuinely decision-track material — pending its own `docs/decisions.md` entry
once actually locked in — or not yet relocated because nothing decided it needs
its own doc yet.

---

## 2–7. Mechanism, vault state, share issuance, fees, rebalancing, custody — MOVED

Extracted 30 Jul 2026 into their own docs, removed from here rather than kept
as a stale duplicate:

- **§2 (the `√k` invariant), §3 (what the vault reads on-chain), §4 (share
  issuance), §7 (non-custodial constraints, draft)** → `docs/mechanism-sqrtk.md`
- **§5 (fees: vault-level HWM, crystallized on every supply change)** →
  `docs/fee-crystallization.md`
- **§6 (rebalance protocol, guardrails, mid-flight state)** →
  `docs/workflows/rebalance.md`
- **The worked-example appendix** → split across the three docs above, each
  hosting the portion that illustrates its own math.

## 8. Where the value to the user comes from

Worth stating plainly because it constrains who we build for. **This section has been revised down** — the earlier version overstated the cost saving considerably.

Proportional costs (swap fees, price impact) are identical whether the user rebalances themselves or the vault does it. Pooling doesn't reduce them at all. What pooling kills is the **fixed** per-order cost, paid once for everybody instead of once per user. The problem is that the fixed cost is smaller than assumed:

| Venue | Batcher / scooper fee |
|---|---|
| Minswap | **2 ₳ flat, per order** — confirmed on-chain requirement (`used_batcher_fee > 0`), not removed. The 29 Jul revision's "0 ₳ since May 2025" was wrong — see the correction in §1 |
| SundaeSwap V3 | ~0.5 ₳ (0.332 base + 0.168 simple; target ≤1 ₳). V1/V2 was 2.5 ₳ |
| WingRiders | 0.85 / 1.5 / 2 ₳ tiered by swap size, plus a **returnable** 2 ₳ oil |
| Splash | not established in this review |

Plus Cardano network fees of roughly 0.2–0.4 ₳ per transaction, and min-ADA UTxO deposits that are returned.

**The rest of this section — the "1.5–4 ₳, close to network cost alone on Minswap" round-trip estimate, the self-managed/vault cost comparison, the breakeven calculation, and the "cost amortization can no longer carry the value argument" conclusion below — was derived from the wrong Minswap figure and needs to be redone, not patched inline.** What's known without redoing the full model: a Minswap rebalance is at minimum three orders (withdraw, swap, deposit) at 2 ₳ each = 6 ₳ in batcher fees alone, before network fees — not "close to network cost alone." That's the same order of magnitude as the "earlier ~8 ₳-per-rebalance figure" this revision set out to correct *downward*, which is worth sitting with: fixing the batcher-fee error may partially undo the conclusion this section reached, not just shift a number inside it. Whether cost amortization is or isn't a strong value driver on Minswap specifically is now genuinely open again — this needs an honest re-derivation with the correct fee, not an assumption in either direction.

The three candidate value props below (allocation decision, not-having-to-watch, low-end enablement) don't depend on the cost-amortization math being weak — they hold regardless of how the redone breakeven comes out. What's not yet re-established is whether cost amortization should be added back as a fourth, or how much weight it deserves relative to these three once Minswap's real fee is in the model.

1. **The allocation decision itself.** Fee APR dispersion across venues and pools is large and moves constantly. That is the product regardless of how the cost math shakes out.
2. **Not having to watch.** Self-management means monitoring multiple venues continuously to know when to move. The cost of that is attention, not ADA.
3. **Enablement at the low end**, which survives on every venue that charges a real per-order fee — including Minswap now that its fee is back in the picture.

Amortization applies to **rebalances only** — each user's own deposit and withdrawal is still an order they pay for individually.

---

## 9. Questions for you

**Q1–Q10 and Q13 relocated 30 Jul 2026** into the "Open design points" section
of whichever new doc now owns that piece of the mechanism — nothing was
answered by moving it, each is still genuinely open:

| Question | Now lives in |
|---|---|
| Q1 (reference-input pool reads), Q2 (circulating LP supply), Q4b (per-venue reserve source), Q4a (multi-venue abstraction shape), Q4c (whitelist enforcement), Q4d (SundaeSwap directional fees), Q7 (no-output-to-executor expressibility), Q8 (CIP-68 mint/burn binding), Q9 (datum sizing), Q10 (rounding/precision) | `docs/mechanism-sqrtk.md` |
| Q6 (crystallize-on-every-change contention cost) | `docs/fee-crystallization.md` |
| Q3 (two-phase deposit shape), Q5 (vault UTxO contention) | `docs/workflows/deposit.md` |
| Q4 (is the slippage bound checkable on-chain), Q13 (v1 venue scope for rebalancing) | `docs/workflows/rebalance.md` |

**Still open here — genuinely about the brief/scope level, not one mechanism
piece:**

11. How much of `legacy/`'s design survives this? What's the honest incremental
    effort versus that architecture, and is there a path that ships something
    simpler first with this layered on later, or is it a rewrite start to
    finish?
12. Anything here that's simply wrong about how Minswap or Plutus works. Please
    say so bluntly — this document's own track record this pass (the batcher-fee
    claim) is exactly why that offer stands.

---

## Appendix — MOVED

The worked numerical example (starting pool → deposits → crystallization →
rebalance, all one continuous walkthrough) is now split across the three docs
whose math it illustrates: `docs/mechanism-sqrtk.md` (starting pool through the
correctness check), `docs/fee-crystallization.md` (the crystallized deposit),
`docs/workflows/rebalance.md` (the rebalance itself). Read them in that order
to follow the original sequence.
