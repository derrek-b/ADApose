# v2 Ideas — parked, not promised

Features deliberately cut from Phase 1, collected so the idea and its known costs
survive without being re-derived. Entries are NOT commitments — each records: the
idea, why it was deferred, the known cost, and what would trigger a revisit.
Graduating an entry = a D-entry in `decisions.md` + a workflow doc, same as any
design change.

## One-signature chained exit (redeem → raw assets)

**Idea:** a redeem's ApplyOrders payout output *is* a Minswap WITHDRAW order
(owner/receiver = user) — the batcher fills it and the user gets NIGHT+ADA having
signed once. Symmetric with deposits (assets in, one sig → assets out, one sig).
**v1 decision (2026-07-19):** LP-out + optional user-signed convert (redeem.md).
**Cost:** the `n4` payout check changes species — the vault validator must verify a
correctly-formed *Minswap* order output (their script address, their datum layout,
user as owner/receiver/refund), coupling our validator hash to Minswap's order
format: a format change on their side breaks us at the hash level (migration, not
patch). Also puts the Minswap batcher into the redemption path (fill latency/kill
semantics — inverts redeem.md's tier-1 "no Minswap dependency" story), splits
`min_out` into two floors (LP terms + asset terms), and someone eats the 2 ADA
batcher fee + order minUTxO.
**Revisit trigger:** real post-launch behavior showing redeemers overwhelmingly
convert LP immediately (if they hold or re-deposit, the feature is pointless).

## Unrelated-token deposits (zap from any asset)

**Idea:** deposit any token, not just pool assets + LP — needs a swap leg
(token → pool assets) chained ahead of the DEPOSIT order.
**v1 decision (D21):** scoped out — deposits accept {pool asset A, pool asset B,
LP} only.
**Cost:** a third chained Minswap order per deposit (swap fill → deposit fill →
our receiver), more batcher latency/failure surface, and slippage policy across
two hops.
**Revisit trigger:** post-demo; user demand for "deposit from ADA-only wallet"
already covered since ADA is a pool asset for NIGHT/ADA — pressure appears with
non-ADA-paired pools.

## WingRiders as venue #2

**Idea:** second DEX venue (D16: rewards agent-pushed, no API dependency; preprod
exists; ~10× smaller TVL). The documented fallback if Minswap's co-sign API or
fill policy disappoints.
**v1 decision (D20):** Phase 1 = Minswap NIGHT/ADA only.
**Cost:** a full `adapters/wingriders` implementation (different order contracts,
datum shapes, farm mechanics) — the D22 adapter boundary exists precisely so this
is additive. Not uniform across its own functions, now that both have actually
been traced (`docs/dex-adapters.md`): `buildCancelTx` is cheap — no official
library builds a Reclaim tx either (checked `@wingriders/cab` directly, found
nothing DEX-specific), but every individual piece needed is already solved by
tooling we have (Lucid + the vendored datum codec + the on-chain redeemer
shape), confirmed by construction. `quoteDeposit`'s zap-in solve is the real
cost — no vendored formula anywhere, genuine reimplementation + correctness
risk against WingRiders' own 4-part fee model, unlike Minswap where the SDK
gives it away free.
**Prerequisite before implementation:** a WingRiders dust test (same shape as
D24's Minswap probe) — `beneficiary`/`compensationDatum` script-receiver support
is only source-confirmed from `Request.hs`/`Pool.hs` (field comparison in
`docs/dex-adapters.md`), never operationally verified against their live agent.
Don't build `adapters/wingriders` on the assumption it fills third-party-script
orders until that's actually run.
**Revisit trigger:** Phase 2 planning, or a Minswap gate failing in practice
(D19 tradeoff table has the analysis).

## CIP-26 token-registry entry for the share token

**Idea:** registry metadata alongside the on-chain CIP-68 (which is decided and
init-baked).
**v1 decision (D20 addendum):** CIP-68 only; registry is optional polish.
**Cost:** trivial (a PR) — deferred because testnet registry wallet support is
spotty and script-policy attestation there is unverified.
**Revisit trigger:** mainnet launch prep.

## Adaptive buffer management

**Idea:** two data-driven knobs on the redemption buffer: (a) restore-piggyback —
when a buffer-miss exit fires during a *negative trailing net flow* window,
withdraw `X + restore` in the same crossing instead of exact X (marginal cost ≈ 0
vs. a future dedicated crossing); (b) dynamic `BUFFER_PCT` — auto-size the buffer
target from observed redemption volume instead of a fixed constant.
**v1 decision (2026-07-23):** wait-for-deposits restore (exact-X withdrawals;
deposits rebuild the buffer for free via the EnterFarm skim line) + a fixed
`BUFFER_PCT` starting guess (redeem.md Open point 3).
**Cost:** flow-tracking machinery (trailing net-flow window, regime detection)
that doesn't exist; behavior change to the exit path; drag risk if the regime
detector is wrong (restored LP earns no emissions).
**Revisit trigger:** post-launch redemption traffic data — the same data the
BUFFER_PCT starting value gets revisited with; do both together.

## Automated emergency escalation (dead-man's switch)

**Idea:** the executor auto-fires the pre-built emergency-withdraw + ExitFarm
pair only after N days of continuous co-sign outage AND M days without a human
heartbeat/veto — automation as a backstop for human *absence*, never a
replacement for human judgment. Upgrades N5 from "trust the team to act" to
"the system acts even if the team can't."
**v1 decision (2026-07-23):** treasury-authorized per runbook (human in the
loop). Every trigger except the key-incident race unfolds at human speed, a
false positive torches real yield (forfeited emissions, unfarmed pool), and the
marginal liveness cost is ~zero while the same operators run executor and
treasury.
**Cost:** careful monitoring plumbing (outage detection robust to flaky reads,
heartbeat infrastructure, veto channel); a bug here nukes yield unprompted.
**Revisit trigger:** team/ops growth or any decentralization push — the moment
"the operators" and "the treasury" stop being the same people.

## Chained fills for the compound cycle (executor address out of the loop)

**Idea:** the cycle's swap order's `successReceiver` = the add-liq order itself
(D21's chaining trick pointed back at Minswap), so MIN → ADA → LP cascades
through the batcher without resting at the executor address — custody window
shrinks to "MIN between harvest and swap placement."
**v1 decision (D23):** plain sequential orders, receiver = executor; the window
is yield-only and accumulation-bounded, so the complexity isn't warranted yet.
**Cost:** order-chaining datum plumbing; a second layer of the
batcher-fills-script-receivers bet (order validator = Minswap's own this time —
separately unverified).
**Revisit trigger:** TVL growth making the yield window material, or the D21/D23
dust tests passing so cleanly that chaining is a small increment.

## Swap-target evaluation (ADA vs NIGHT by live pool state)

**Idea:** pick the cycle's swap target per-cycle by comparing effective cost
(swap slippage + single-sided price impact) across MIN→ADA vs MIN→NIGHT routes.
**v1 decision (D23):** always MIN → ADA — deepest MIN pool, single hop
(MIN→NIGHT routes through ADA anyway), and at harvest scale the difference is
pennies.
**Cost:** live multi-pool depth reads + route math in the adapter.
**Revisit trigger:** harvest sizes large enough that single-sided price impact
shows up in the PoR rate telemetry.

## Permissionless vault init (new pools without treasury)

**Idea:** anyone can init a Pomona vault for a new Minswap pool.
**v1 decision:** treasury-signed init presumably (vault-init.md open question —
v1 answer decided there when init is designed).
**Cost:** must prove a junk-pool init can't harm real vaults or users (N6 scoping
suggests it can't — each vault is its own NFT-keyed world — but "suggests" isn't
a test), plus curation/UX questions.
**Revisit trigger:** Phase 2+ multi-pool expansion.

## Order-UTXO consolidation: same-canceller merge (candidate for v1)

**Idea:** a permissionless redeemer on the order validator that merges N order
UTxOs sharing the same `canceller`+`payout`(+`pool_nft`) into one output,
conserving the exact summed value. Surfaced designing `deposit.md`'s Step C
discovery pipeline: the order validator has no way to forcibly remove a
well-formed but permanently-ineligible order (unsatisfiable deposits, orphaned
`pool_nft`) — Rescue explicitly can't reach them either ("a castable order with
a wrong `pool_nft` or unsatisfiable `min_out` is recoverable by its own
`canceller` — Cancel is the owner's path, Rescue is irrelevant," `rescue.md`) —
so they accumulate forever at the shared order-validator address, growing
Blockfrost's `utxosAt` pagination cost on every discovery tick (executor-side
caching mitigates our own reprocessing, not this fetch cost). Safe by
construction: the owner's recovery is exactly preserved (same signature, same
total value, still unconditional), never degraded, so it doesn't touch N4 at
all — no trust assumption needed in whoever submits it.
**v1 decision:** not built yet — genuine candidate to build before pitch day if
time permits; otherwise falls to Phase 2 like everything else here.
**Cost:** narrow — a value-conservation + same-owner check (closer in shape to
`n1_totals` than a new subsystem), its own `aiken check -m` coverage. Minimal
web-side cost: a merged order's ref going stale is already handled by
`listMyLegs`' live re-derivation, same mechanism as any zone transition. Only
mitigates a griefer reusing one wallet — an attacker spreading junk across many
fresh keys is untouched (nothing to merge across different owners) — a partial
mitigation, not a full fix.
**Revisit trigger:** build before pitch day if time allows; otherwise Phase 2,
or if observed on-chain bloat becomes a measurable problem.

## Order-UTXO consolidation: multi-owner merge (not planned for v1)

**Idea:** the same consolidation concept extended across different cancellers —
a merged UTXO's datum encodes a list of `{owner, entitled_value}` claims, with a
new redeemer letting any listed owner independently withdraw their exact share,
leaving the rest untouched. The harder sibling of the same-canceller version
above; considered and set aside in the same design pass.
**v1 decision:** rejected for v1, not a "build if time allows" candidate even
with extra runway — see cost.
**Cost:** substantial — a genuine new sub-system nested inside the order
validator (variable-length claimant list in the datum, partial-withdrawal
logic, its own size/execution-unit budgeting), meaningfully more complex than
anything else in the order-validator design, plus a third leg-state
(`checkLegStatus`/`cancelOrder`) the web would need to track alongside the two
zones it already does. Preserves N4 correctly if built (every owner's claim
stays fully independent) — rejected on cost/benefit, not security: it defends
specifically against multi-wallet griefing, and that threat is already largely
self-limiting (real, recoverable ADA cost to the attacker, zero actual gain).
**Revisit trigger:** observed sustained, deliberate multi-wallet griefing in
production — not just theoretical risk.

## Persistent ineligible-order cache (survive executor restarts)

**Idea:** back `ineligibleCache` (`deposit.md` Step C) with something durable
— a local file, SQLite, or similar — so a permanently-dead order ref stays
skipped across executor restarts, not just within one process's uptime.
**v1 decision:** in-memory only (a plain `Set<OutputReference>`) — a restart
just costs one tick's worth of full reprocessing before it rebuilds; no
correctness impact, purely a one-time CPU cost.
**Cost:** trivial functionally — this is a cache, not a source of truth, so
losing it and rebuilding from chain state is always safe (same discipline as
N1's "the chain is the only state" applied elsewhere) — but a durable version
adds a real operational dependency (a file/DB to manage, back up, or corrupt)
for a benefit that only ever amounts to "skip re-decoding a known-dead order
once per restart." Restarts aren't frequent enough at v1 scale to matter.
**Revisit trigger:** executor restarts become frequent enough (aggressive
redeploys, crash-looping) that the reprocessing cost after each one becomes
measurable, or the ineligible set grows large enough that even one full
reprocessing pass is meaningfully slow.

## Sibling-hold for mixed deposits (one credit event)

**Idea:** hold a mixed deposit's LP-leg order until its asset-leg sibling's
fill arrives, then apply both together in one `ApplyOrders` batch at the same
rate — so the deposit reads as one credit event instead of two. Fully
traceable with zero new on-chain fields: both legs share one `tx_hash` by
construction (`deposit.md` Step A #5/#6 — one signed tx, up to two order
outputs), and a filled sibling's resulting order is identifiable by an exact
datum match against content already read from the origin tx — no `batch_id`,
no persisted executor state needed, restart-safe via a plain historical tx
lookup.
**v1 decision (2026-07-26):** not built — legs apply independently as each
becomes eligible (`deposit.md` Step A failure branches, Step C #3).
**Cost:** mechanically sound but the benefit is purely cosmetic — each leg
already carries its own `min_shares` floor, computed independently, so it's
already fully protected regardless of when it applies relative to its
sibling (same rate-neutrality argument that protects against any other
pending order, Step A). Holding closes no real safety or fairness gap; it
only makes the transaction history look like one event instead of two.
Against that: genuine state-machine complexity (per-order hold state, a
timeout clock, exclusion from batching until released) for a v1 that's a
single demo pool on a pitch-day build.
**Revisit trigger:** a specific product/demo reason to want the smoothed
single-event presentation (e.g. showing a live mixed-deposit flow where two
separate mint events landing visibly apart would read as confusing) — a UX
call, not a correctness one, so it can be picked up any time without
unwinding a design decision.

## Individual per-user vaults alongside the pooled vault (dual product line)

**Idea:** offer a second, non-custodial product line next to today's pooled
auto-compounding vault — surfaced discussing whether Pomona can be described
as non-custodial for filings/bank-onboarding purposes. Two parts, easy to
conflate but genuinely different:
1. **D17 (no farm at all):** a script-owned LP vault with no farm
   participation — genuinely non-custodial always, yield = trading fees only.
   Already fully designed (D17); not built because D20 chose farm-yield
   compounding as the Phase 1 product.
2. **D1 + D16/D18 revived (per-user vault, still pooled at the farm layer):**
   individual user-owned vault UTxOs, but every vault's LP still funnels into
   the *same* executor-keyed Minswap farm position (Minswap allows one owner
   pubkey per pool, full stop — D19). This does **not** achieve non-custodial
   farm yield — D20's own point 2 says so directly: *"already broken by the
   farm layer regardless of vault topology... ~100% of assets are farmed
   ~100% of the time, under executor keys. Both designs end at the identical
   custody disclosure."* What it buys instead: the **unfarmed buffer**
   becomes genuinely per-user/Tier-1 (D18 scorecard: "idle sovereignty T1")
   instead of commingled in one shared UTxO like today's pooled buffer, plus
   a structurally different claim form (an individual on-chain record naming
   this user, vs. a fungible share of a commingled pool) that may read
   differently for legal/regulatory characterization — a question for counsel,
   not something the architecture itself resolves.
**v1 decision (D20):** rejected — the per-user + pooled-farm shape (variant 2)
is exactly D1, superseded specifically because the executor-keyed farm forces
the full D18 claim state machine (`Idle → Entering → Farming →
WithdrawRequested → consumed`; `Enter`/`Reconcile`/`Settle` redeemers;
reference-input reconciliation; per-vault fee ledgers) *plus* pro-rata share
math anyway (batched compounds still split gains across participating
vaults) — heavier than the pooled design, for a non-custodial story that
turned out not to hold for the farmed majority of funds anyway.
**Cost:** this is not incremental on top of the current build — it's a full
second validator + redeemer set + state machine, its own `aiken check -m`
coverage, and its own audit surface, maintained in parallel with the pooled
vault (D17's variant is cheap by comparison — it reuses the vault
architecture per D17's own text and needs no state machine at all, since it
never touches a farm). The one technical risk D18 flagged but never closed
before being superseded — whether a referenced Minswap farm position can be
*proven* on-chain to belong to a specific vault's claim, or degrades to
executor-attested (D18: "principal T1-if-tagging... If tagging fails,
principal_lp degrades to executor-attested"; called "Most important dust
test") — would need to be resolved first if variant 2 is ever revived; it's
never been tested.
**Revisit trigger:** a regulatory/banking requirement to offer a genuinely
non-custodial product line (→ build D17's variant, the cheap one, first) or
a specific case for individual-claim/segregated-buffer framing that the
pooled model can't make (→ variant 2, expensive, and still doesn't cover
farmed capital).

## Multi-pool compound-cycle attribution (which pool does this MIN/ADA belong to)

**Idea/problem:** surfaced designing `compound-cycle.md`'s executor-side
mechanics — once harvested MIN (tx1) and swapped ADA (tx2) land at the
executor's own wallet, they sit at a plain pubkey address with no datum, no
thread NFT, nothing pool-scoped at all — just a `Value`. Pool identity is
only recoverable once funds are back at something script-scoped (the add-liq
order's `pool_nft`, the `ApplyOrders` absorb) — the intermediate window (tx1
harvest → tx2 swap → tx3 add-liq placement) has no on-chain way to attribute
a wallet balance to a specific pool's cycle if more than one pool's cycle is
running concurrently. Two real fixes considered, a genuine tradeoff, not a
clear winner:
- **Global serialization** — never run two pools' compound cycles
  concurrently, full stop (stricter than the existing "one vault spend in
  flight per pool," Step D). Resolves the ambiguity for free — whatever's in
  the wallet belongs to whichever pool most recently triggered — but costs
  cross-pool throughput: a second pool's ready trigger waits out the first
  pool's entire cycle even though nothing about the second pool's own state
  requires that.
- **Per-pool dedicated executor sub-addresses** for compound-cycle
  intermediate custody — derive a distinct address per pool from the same hot
  key (one overall key-custody/signing model, D18, multiple addresses under
  it), so "MIN at address A" is unambiguous by construction, no serialization
  cost. Unverified whether tx1's output shape is even ours to control closely
  enough for datum-tagging instead — it's built via Minswap's own
  `buildMultipleHarvestsV2` API, not our own order-validator output — so
  address-separation is the more clearly-available lever of the two, not
  assumed, just the one we don't need to check permissions for.
**v1 decision:** moot — Phase 1 is a single pool (D20), so any MIN/ADA at the
executor address can only ever belong to that one pool's cycle. Zero
ambiguity exists until there's a second pool.
**Cost:** whichever fix is chosen, real: global serialization costs
cross-pool compounding throughput; dedicated sub-addresses cost multi-address
key-management complexity under the same custody model (D18's MPC/multisig
posture would need to cover every derived address, not just one).
**Revisit trigger:** Phase 2+ multi-pool expansion (same trigger as
"Permissionless vault init" above) — this becomes real the moment a second
pool's compound cycle can overlap in time with the first's.
