# Pomona Finance — Interview Crib Sheet
*Genesis screening interview · numbers verified July 12–13, 2026 · re-verify items marked ⟳ Sunday night*

---

## 1. COST MODEL — the three constants

| Constant | Value | Source |
|---|---|---|
| Fixed cost / compound round / pool | **~5 ADA** (4 = two Minswap batcher fees + ~1 network) | Minswap SDK: `github.com/minswap/sdk` → `src/batcher-fee/configs.internal.ts` → `BATCHER_FEE_DEX_V2 = 2_000_000` lovelace, flat, every order type |
| Marginal cost / vault touched | **0.1–0.3 ADA** (bytes + validator execution; use 0.3 in all math) | Derived from protocol params (0.16 base, 0.000044/byte, exunit prices). Exact in Week 1 — deterministic |
| Revenue | **~0.39% of AUM / year** (4.5% fee × 8.6% emissions) | Fee = our design (Beefy precedent) · APR = Minswap farms UI **July 13, 3pm PDT** (pool fee APR 8.47 / farm 8.6) |

**Envelope limits:** 16KB max tx → ~20–30 vaults/batch tx; extra envelope ≈ +0.2 ADA. Nothing cliff-like — costs stay linear.

## 2. THE TRIGGER RULE — profitability as invariant, not forecast

> **Compound a vault only when its accrued fee-share ≥ 2× its marginal cost.**

- Rounds/yr = annual fee ÷ (k·m) → **annual marginal cost = revenue ÷ k. With k=2, costs are pinned at HALF of revenue — that's the FLOOR, not the number (see margin curve below).**
- 3K ADA vault → triggers every ~2.7 weeks. 10K vault → weekly (capped).
- **Weekly crossover: AUM = k·m·52 ÷ (fee% × APR) ≈ 8,100 ADA** at current rates. Below: trigger-bound (50% floor). Above: cap-bound at weekly — costs freeze at ~15.6 ADA/yr while revenue scales, margin climbs.
- Say it: *"Every transaction we submit is profitable by construction. The margin isn't a projection — it's the trigger constant."*

**Worked table (one rule, k=2, m=0.3, APR 8.6%):**

| Pool | Cadence | Revenue/yr | Costs/yr | Net | Margin |
|---|---|---|---|---|---|
| 100 × 3K ADA (300K) | 2.7 wk | 1,160 | 680 | +480 | 42% |
| 100 × 10K (1M) | weekly | 3,870 | 1,820 | +2,050 | 53% |
| 1,000 × 3K (3M) | 2.7 wk | 11,610 | 5,900 | +5,710 | 49% |

**Vault-size margin curve (weekly cap at ~8.1K ADA is the inflection):**

| Vault size | Fee revenue/yr | Cost/yr | Margin |
|---|---|---|---|
| 3K ADA (trigger-bound) | 11.6 | ~6 | ~50% — floor |
| **~8.1K — weekly crossover** | 31.2 | 15.6 | 50% |
| 10K (cap-bound) | 38.7 | 15.6 | 60% |
| 30K | 116 | 15.6 | 87% |
| 100K | 387 | 15.6 | 96% |

→ Portfolio margin: 50% at worst, rises with average position size. Whale-heavy book ≈ pure margin. Raising k to 3 lifts the floor to 67% (costs users only basis points of compounding frequency).

**DIY comparison:** manual compound = ~5.2–5.6 ADA/cycle (two 2-ADA batcher fees paid ALONE), fixed regardless of position size. At a rational cadence (every ~2.7 wks, matching our trigger) ≈ ~105 ADA/yr — **~40% of a 3K vault's ~258 ADA emission yield** — vs Pomona ~7 ADA/yr at the same cadence: **~15×**. Naive weekly DIY = 270–290 ADA/yr (~20–30×). DIY's dilemma: compound often and burn yield on fees, or compound rarely and hold a growing MIN bag — batching removes the dilemma.

## 3. YIELD MATH — the $1,000 (3K ADA) position

- Two streams: **trading fees 8.47%** (auto-accrue in pool, we don't touch/fee) + **MIN emissions 8.6%** (idle until compounded — our product) — Minswap UI July 13, 3pm PDT
- "Half the position's yield sits idle by default" — the hook
- Pomona nets user ~$7/yr ahead of perfect-passive (compounded capital earns the FULL ~17.1% stream) + sheds MIN price risk weekly + zero effort
- Our take: 4.5% of harvested emissions only ≈ **~$4/yr per $1K**. No deposit/withdraw/management fees
- Concession if pushed: modest edge at 8.6% — compounding gains scale with APR *squared*, fee linearly → hot pools (30–50% launch farms) are where it prints. NIGHT/ADA is the worst case and we're still net-positive

## 3½. BULL CASE — $500M LP TVL (≈ Cardano returns to its own March 2026 peak)

*Anchor: chain TVL peaked $1.1B four months ago; LP share ~half. This is recovery, not fantasy.*

| Scenario | AUM | Fee revenue/yr | Net (~50% floor) |
|---|---|---|---|
| 5% capture, current 8.6% APR | $25M | ~$97K | ~$50K |
| 10% capture, current APR | $50M | ~$195K | ~$100K |
| 5% capture, 20% growth-era APR | $25M | ~$225K | ~$110K |
| 10% capture, 20% APR | $50M | ~$450K | ~$225K |

- **Fee lever stacks on top:** at blended 10% fee (Yearn V3 default, under Beefy's 9.5% max) bottom-right → ~$1M revenue / ~$500K+ net. One knob, no new users.
- Capture sanity: Beefy/Yearn peaked ~5–6% of chain TVL **against a dozen competitors each**; we model 5–10% as singleton.
- Cost base = one founder + a server. Margin floor 50% is the pessimistic end (see margin curve — whale-heavy book runs 60–90%+).
- Say it: *"If Cardano just returns to its March peak and we hold ten percent as the only product in category — $200K a year at today's depressed rates, roughly a million at bull APRs with fees at what Yearn charges today. On a cost base of one founder and a server."*
