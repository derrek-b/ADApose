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
is additive.
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
