<!-- Source: legacy/validators/validators/vault.ak -->
# Workflow: Compound Cycle (harvest → LP → recorded yield)

**Path:** farm emissions —API harvest→ executor —swap order→ ADA —add-liq order
(`successReceiver` = our order validator)→ `HarvestDeposit` fill —ApplyOrders
absorb→ vault (`total_lp` up, rate up) —EnterFarm skim→ farm.
**Decisions:** D23 (this shape — confirmed sole compound path per D24), D3
(trigger + weekly cap), D19 (API + verifier), D20 (fee design), D21 addenda
(harvest-priority, precedence), D12 (swap slippage floor), D22 (adapter boundary),
D24 (the batcher fill-policy bit — resolved, see below).
Evidence tags per `README.md` — ✅ verified / ⚠️ unverified.

## What's new here vs. reused

New: the trigger machinery; the first swap order we ever build (D12 floor becomes
real); the `HarvestDeposit` action (the one new ApplyOrders branch); the
multi-step resume story.

Reused deliberately: the D21 fill-delivery pattern (the
absorb IS a deposit-shaped fill — same receiver, same on-chain delivery
enforcement, operationally confirmed working per D24), the enter-exit crossing
machinery, the verifier discipline, pass-through value handling.

## Trigger (D3, restated pool-level in D20)

Fire when: pool's aggregate pending rewards ≥ `2 × cycle_cost` (~5–7 ADA
assumed — dust item (g) measures) AND ≥ `MIN_CADENCE` since last cycle
(weekly cap). ⚠️ pending-rewards readability = dust item (d) — drives this
trigger, the deposit tolerance floor, and the trigger-imminent warning.
On fire: **harvest-priority engages** — no other ApplyOrders lands for this pool
until the absorb (step 4) is applied (D21 addendum; anti-JIT-snipe). The hold
window (minutes to tens of minutes, weekly) is **inherent to compounding,
shape-independent**: it can't end before the rate event, which can't happen
before the batcher has converted MIN → LP — both shapes contain the same two
fills, and the absorb tail is actually one tx SHORTER than the alternate's
(fill+absorb vs fill+stake+RecordHarvest). Nor can the hold narrow to
redeems-only: holding deposits IS the anti-snipe point (a deposit applied
mid-window buys the old rate and captures the imminent harvest). Deposit-order
deadlines already price the window (`T_max`/`DEADLINE_MARGIN` machinery, deposit.md Step D).

## The cycle (absorb shape — D23 primary)

1. **tx1 — API harvest:** `buildMultipleHarvestsV2` (✅ schema; multi-pool
   first-class — irrelevant at one pool, free scale-lever later). Verify
   (rewards → owner, no leakage, signers = owner + Minswap) → owner-sign →
   submit. MIN lands at the executor address.
2. **tx2 — swap order (ours, first swap in the system):** MIN → **ADA**, ONE
   swap (D23: MIN/ADA is the deepest MIN pool; swap-to-NIGHT routes through ADA
   anyway; topology is adapter-level — D22). Receiver = executor address (v1;
   chained fills = v2-ideas). `min_receive` per the D12 slippage floor vs. spot —
   the minimum-ADA-out bound on the swap (standard slippage protection; no
   relation to the MIN token despite the name). Batcher fills; ADA joins the
   executor address.
3. **tx3 — add-liq order (ours):** single-sided ADA → NIGHT/ADA pool DEPOSIT
   order (imbalanced deposits native — D5) with **`successReceiver` = our order
   validator**, `successReceiverDatum` = HarvestDeposit order datum:
   ```
   { pool_nft, canceller: Signature(executor), payout: executor_addr,
     action: HarvestDeposit, min_out: 0 (ignored — Open point 3), deadline }
   ```
   Same delivery enforcement as user deposits (✅ `validate_order_receiver`),
   same operational bet — ✅ **confirmed working per D24** (real mainnet probe,
   not just source-verified). Batcher fills; LP + mandated inline datum land
   at our order validator.
4. **tx4 — ApplyOrders (absorb):** the `HarvestDeposit` branch —
   ```
   lp        value-derived (gap-2 rule) — the fill IS the ΔLP witness
   total_lp  += lp        farmed_lp unchanged        rate RISES (C5)
   mint      == treasury fee shares ONLY: t = floor(fee_bps × lp × S/L)
             (fee-mint bound t ≤ floor(lp·S/L) trivially satisfied at 4.5%;
              NO user-style share mint — yield is a rate event, not principal)
   payout    pass-through: order extras (minUTxO ADA) → executor
   ```
   Enforcement note: value-derivation makes ΔLP chain-witnessed — the executor
   cannot overstate a harvest (the "RecordHarvest lying" problem dissolves in
   this shape).
5. **Later — EnterFarm skim (normal machinery):** the absorbed LP sits unfarmed,
   replenishing the redemption buffer first (wait-for-deposits synergy); the
   surplus above `buffer_target` enters the farm on the usual policy. One extra
   crossing per cycle vs. the alternate shape — accepted (D23).

## Custody & resume (the cycle-specific machinery)

- **Custody window: yield only, never principal.** MIN then ADA rest at the
  executor address between tx1 and tx3's fill; magnitude ≤ one accumulation
  window (trigger ≥ 2× cycle cost, ≤ weekly cap). Principal stays in
  vault/farm custody throughout. This bound IS the v1 mitigation (D23);
  shrinking the window further (chained fills) is v2.
- **Stateless resume — `getCompoundCycleState(poolKey) → 'idle' |
  'harvesting' | 'swapping' | 'adding-liq' | 'pending-absorb'`.** Cycle
  position is derived, never stored — what sits where tells the executor
  what's next: MIN at executor ⇒ place swap; ADA ⇒ place add-liq order;
  pending Minswap order ⇒ wait/re-place; HarvestDeposit fill at order
  validator ⇒ absorb; nothing ⇒ idle. Crash-safe at every seam; same
  philosophy as the indexer everywhere else. Two callers, one
  implementation, not duplicated: the cycle's own execution driver calls it
  to decide what step runs next, and `deposit.md`'s `selectBatch` (Step D)
  calls it to decide whether to hold regular `ApplyOrders` batches for this
  pool (harvest-priority). Genuinely new polling, not covered by anything
  else already running — three of the four states (MIN/ADA at executor,
  pending Minswap order) require querying the executor's own wallet address
  and Minswap's order address, neither of which `discoverOrders` (Step C)
  already reads; only the `HarvestDeposit`-fill check reuses that existing
  poll.
- Verifier intents (new catalog entries): harvest tx (above); swap order
  (min_receive floor, refund = executor); add-liq order (successReceiver +
  exact datum, minimumLP, refund = executor); absorb tx (standard ApplyOrders
  intent + the HarvestDeposit branch expectations).

## Failure branches

- **Swap/add-liq order killed or expired** (price moved past the floor, batcher
  timeout) → funds refund to executor under Minswap's own rules; **re-quote at
  current spot, re-place with a fresh floor**. Retry loop, transient, no
  alternate path. The floor converts price drift into kill-and-requote: never a
  fill worse than stated, but drift itself isn't dodged — see next.
- **Fill never comes — the categorical risk is RESOLVED (D24):** confirmed via
  a real mainnet probe that the licensed batcher does fill
  third-party-script-receiver orders — the absorb shape isn't a bet anymore,
  it's the only shape (`RecordHarvest` deleted, no alternate to flip to if this
  had gone the other way). What remains is a narrower, ordinary risk: an
  *individual* add-liq order still not filling for transient reasons (batcher
  outage, price moved past the kill threshold) — same retry-loop as the
  swap/add-liq failure branch above, not a structural gap. **Open question this
  surfaces, not yet decided:** with no alternate compound shape left, what
  happens on a genuinely *sustained* batcher outage (not just one stuck
  order)? Compounding presumably just pauses — no principal at risk either way
  (redemptions, farm machinery, vault never touch the batcher) — but that's an
  implicit consequence of deleting the alternate shape, not something
  explicitly decided. Worth a line in `week1-verify.md` or its own open point
  here rather than left unstated.
- **Crash mid-cycle** → stateless resume above.
- **MIN price drift — NOT a failure branch, just yield variance:** if MIN falls
  and stays fallen, the retry loop fills at the lower price; the harvest is
  worth less, principal untouched, no code path changes. Exposure spans the
  whole accrual window (emissions are MIN-denominated from the moment earned),
  not just the cycle's minutes. Accepted, v1 and beyond absent a hard rethink
  (2026-07-24): hedging machinery (shorts/perps) inverts the risk profile —
  introduces principal-loss paths to smooth upside variance users already
  accept as farm APR. The honest lever at scale is harvest cadence (shrinks
  the accrual window), which the trigger already parameterizes.
- **Harvest-priority starvation** (fills slow, user orders queuing) → the hold
  is per-pool and bounded by the deposit deadline machinery; if the absorb
  exceeds `T_max`-scale delays, orders near deadline are excluded from the next
  batch as usual (`DEADLINE_MARGIN`, deposit.md Step D) — the cycle never
  strands user orders past their deadlines (n4 validity bound enforces).

## ~~Alternate shape — RecordHarvest~~ DELETED (D24, 2026-07-25)

Direct path (historical, no longer buildable): harvest → swap → add-liq
(receiver = executor's own address — ordinary batcher usage, no script
receiver) → API stake → `RecordHarvest` vault spend: `total_lp` += ΔLP,
`farmed_lp` += ΔLP, treasury fee mint, ΔLP enforced via the farm position as a
reference input. This was kept pending the batcher dust test's result — the
test ran (2026-07-25, real mainnet probe, not just source-verified) and
confirmed the licensed batcher DOES fill third-party-script-receiver orders,
so the absorb shape (above) is the sole compound path. Per D24: "`RecordHarvest`
is DELETED (not merely demoted) — the vault redeemer set is now final." Not a
kept alternate; `vault.ak` never carries this redeemer.

## Open design points

1. ~~**RecordHarvest fate**~~ **RESOLVED 2026-07-25 (D24)** — the batcher dust
   test ran and confirmed third-party-script-receiver fills work operationally,
   not just on-chain-permitted. Absorb (above) is the sole compound shape;
   `RecordHarvest` is deleted, not kept as an alternate. See D24 for the full
   evidence (tx hashes, 4-way independent verification).
2. **Harvest-priority hold-window tuning** — baseline placeholders at build
   time (`shared/` constants; e.g. `T_max` ≈ 30 min, `DEADLINE_MARGIN` ≈ 10 min,
   sized generously — the three-clocks inequality from deposit.md fixes their
   relationship, only the numbers are open), then tune against observed batcher
   latency on preprod. The window itself is shape-independent (Trigger section).
3. ~~**`min_out` semantics for HarvestDeposit.**~~ **RESOLVED 2026-07-24 —
   ignored.** The branch does not read `min_out` (executor writes 0 by
   convention). Why: a floor only protects when its setter and the party it
   guards against differ — here the executor sets it AND produces the outcome,
   so checking it verifies a tautology; refusing an already-landed fill helps
   nobody (it would just strand LP at the order validator); and the real
   protections live elsewhere — Minswap's own validator enforces `minimumLP`
   at fill time (a worse fill cannot exist on-chain), and the D19 verifier
   gates our order construction pre-sign. Carry this rationale as a code
   comment on the check branch when vault.ak is written (sketch already notes
   it).
