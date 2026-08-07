# v2 Ideas — parked, not promised

Features deliberately cut from the current scope, collected so the idea and its
known costs survive without being re-derived. Entries are NOT commitments — each
records: the idea, why it was deferred, the known cost, and what would trigger a
revisit. Graduating an entry = a D-entry in `decisions.md` + a workflow doc, same
as any design change.

**Started fresh 2026-07-30 (D26).** The prior version of this file — fourteen
entries parked against the farm-emissions auto-compounding architecture — moved
to `legacy/docs/v2-ideas.md` with the rest of that design when it was archived,
not deleted. One entry from it was genuinely architecture-agnostic and is carried
forward below rather than left stranded in `legacy/`; check there before
re-deriving an idea that sounds familiar, in case it's already been thought
through.

## CIP-26 token-registry entry for the share token

**Idea:** registry metadata alongside the on-chain CIP-68 token standard,
independent of which specific vault mechanics back the share token.
**v1 decision (carried from the prior architecture, D20 addendum):** CIP-68
only; registry is optional polish.
**Cost:** trivial (a PR) — deferred because testnet registry wallet support is
spotty and script-policy attestation there is unverified.
**Revisit trigger:** mainnet launch prep, whenever that is for whichever
architecture ships.

## Pooled vaults — team-managed strategy, cost-amortized for small positions

**Idea:** a separate service alongside individual vaults (D27, `decisions.md`):
one shared vault per (pool, strategy) combination holding many users'
commingled assets, users hold a fungible share token, strategy parameters are
team-set and locked (not user-customizable — pooling only makes sense with
one shared policy). Motivated specifically by cost-amortization: strategies
with expensive per-operation legs (e.g. Lend & Earn's borrow/repay/rebalance
actions) are uneconomical for a small position to run solo; pooling amortizes
those fixed costs across everyone using that pool/strategy pair.

**Deferred, not abandoned** — an entirely separate service from individual
vaults, not something to design now. Individual vaults + team-locked strategy
templates (FUM's own Template pattern — `selectedTemplate`/
`customizationBitmap` in `BabyStepsStrategy.sol`, `~/code/fum_project`)
already cover "hands-off, we picked the knobs for you" for users who don't
want to think about parameters, at zero extra architecture cost. Pooled
vaults are specifically for positions too small to economically absorb a
strategy's per-operation costs even with parameters fixed — a narrower,
separate case from "don't want to configure knobs."

**Known cost / design guardrail already agreed, if/when this gets built:**
reuse the individual-vault validator's underlying logic (destination-
whitelist checks, DEX-adapter interaction, strategy-parameter reading) via a
shared Aiken library module + the same off-chain `shared/` package pattern
D22 established — **not** by making pooled vaults and individual vaults the
same validator/script, even though they'd sit at the same conceptual layer.
A shared script would: (a) dilute individual vaults' whole reason for
existing — a smaller audit surface — since auditors would have to review the
pooled-mode share-math invariant class (dead shares, house-favored rounding,
batch-rate uniformity — D20-N's whole class) regardless of which mode a
given vault actually uses, because it's the same hash; (b) couple migration
lifecycles that don't need to be coupled — a pooled-only bugfix would force
individual-vault users into an unrelated migration; (c) open a
mode-confusion attack surface (a redeemer meant for one mode misapplied
against the other mode's datum shape) that doesn't exist if the scripts stay
separate — an N6-flavored bug class, same shape as D22's adapter-boundary
reasoning one level down.

**Revisit trigger:** once an actual pooled-cost-uneconomical strategy is
built and shipped for individual vaults (Lend & Earn or similar) and real
usage data shows small positions being priced out of it solo.

## Run our own Cardano node instead of Blockfrost/Koios

**Idea:** stand up our own `cardano-node` plus an indexer layer on top
(db-sync + Postgres, or Kupo/Ogmios) — always-on infrastructure giving
direct queryable access to raw chain state, replacing third-party APIs
entirely for `automation/sqrtk/`'s own measurement needs. No rate limit, no
per-request cost, no dependence on Blockfrost's/Koios's continued pricing
or uptime.

**Deferred, not abandoned** — genuine always-on ops burden (multi-TB fast
storage that only grows, continuous uptime, node-version/hard-fork
maintenance) is a different operational posture than today's run-when-needed
CLI toolkit, and a long initial sync besides. Not a drop-in swap either: the
existing reserve/treasury/LP-supply extraction logic is built against
Blockfrost's REST shape and would need real rework against db-sync's schema
or Kupo's API. Matches the same discipline that deferred Redux (D29) and the
API/DB layer (D29) — don't build infrastructure ahead of proven need.

**Why it's more than a one-off idea, though:** `docs/decisions.md` D29's own
addendum already flags that the eventual wallet/tx-building layer
(`@minswap/sdk-v2`'s `KupoRpcProvider`) will need a running Kupo instance for
a completely unrelated reason (resolving a wallet's own UTxOs into CBOR). If
that need materializes, the same node+indexer could serve both consumers —
the measurement toolkit and the future RpcProvider — rather than standing up
two separate pieces of infrastructure at different times.

**Known cost:** `cardano-node` + (`db-sync`+Postgres, or Kupo/Ogmios) as a
minimum stack; a dedicated always-on host with substantial fast storage;
ongoing maintenance across hard-fork/protocol-era upgrades; a real
integration effort porting the venue-specific field-path logic in
`sqrtk_core.py`'s `Venue` configs to whatever query shape the chosen
indexer offers, not just pointing the existing Blockfrost client elsewhere.

**Revisit trigger:** Blockfrost's rate limit or cost actually becomes a
binding constraint in practice (not just a design-phase consideration) — the
lower-commitment interim step being a paid Blockfrost/Koios tier first — or
the wallet/tx-building layer's own Kupo need materializes, making shared
infrastructure worth building once for both purposes.

## DexHunter as a non-custodial swap-routing dependency, for a future zap-less venue

**Idea:** for a DEX venue with no native single-sided/virtual-swap deposit
mechanism, route the swap leg of a "swap-then-deposit" zap-in through
DexHunter's aggregation rather than building venue-specific swap logic
directly. DexHunter is itself non-custodial — a routing layer, not a vault —
so a transaction built against it can still send every output straight to
the user's own address or their individual vault, preserving D27's
no-output-to-us invariant exactly as using a single DEX directly does.

**Not needed for v1's two venues.** Checked against `docs/dex-adapters.md`'s
own research: Minswap already supports any-ratio (including single-sided)
deposits in one order via its virtual-swap quadratic solve; WingRiders
auto-swaps a true single-sided deposit natively, and its one real gap
(two-sided-imbalanced) is already resolved by splitting into two orders, not
an external swap. DexHunter only becomes relevant once a third venue is
added that genuinely lacks any internal zap mechanism of its own.

**WingRiders' two-sided-imbalanced gap independently re-confirmed against
actual on-chain source (2026-08-04), not just cited secondhand.** Read
`reference/wingriders-onchain/ConstantProduct.hs`'s `paddLiquidity`
directly (lines 470-487): both full deposit amounts are merged into pool
reserves unconditionally (`qtyA = state.qtyA + addA`, `qtyB = state.qtyB +
addB`), and only `earnedShares = min(earnedSharesFromA, earnedSharesFromB)`
gets minted — there is no branch anywhere in this function that returns or
holds back the excess. It isn't "unused balance sits somewhere recoverable"
— by the time shares are computed, the excess is already inside the pool's
reserves with no share claim attached, a permanent, unrecoverable donation
to the pool's *other* LPs. This is source-verified (authoritative — this is
what consensus enforces for any transaction meeting these constraints), but
still **not operationally dust-tested** against a live WingRiders agent —
matches `docs/dex-adapters.md`'s own evidence-tier convention (source-level
≠ dust-tested). Confirms the "split into two orders" design above is a real
requirement to build correctly, not just a UX nicety: a naive single
off-ratio order submitted to WingRiders on a user's behalf would cost them
real value, silently.

**Two composition shapes, not one:** if DexHunter's chosen route only
touches atomic AMM-style swaps, swap + deposit can likely be one atomic,
single-signature transaction; if the route includes a batched/order-book
venue, it becomes two sequential transactions (swap, wait for batcher fill,
then deposit) instead — still fully non-custodial (the intermediate output
sits in the user's own UTXO throughout), just not atomic.

**Known cost:** a dependency on a third party's aggregation API and fee,
stacked on top of the underlying DEX's own trading fee and ADApose's own
execution fee (`decisions.md` D28's Phase 1 revenue model) — worth weighing
against building the equivalent "best route across known DEXs" logic
directly against each DEX's own swap contracts once a real zap-less venue
is actually in scope, rather than depending on a third party's pricing/
uptime for something structural.

**Revisit trigger:** a DEX venue beyond Minswap/WingRiders gets added
(2027+ roadmap, D28) that has no native single-sided or virtual-swap
deposit path of its own.

**Separate angle, parked here rather than as its own entry (2026-08-04): a
fee-share/rebate partnership, not just a technical dependency.** If we do
end up routing through DexHunter (or an equivalent aggregator) for a
zap-less venue, worth exploring whether they'd rebate/split some of their
own routing fee for volume we send them — a revenue angle layered on top of
the technical case above, not a substitute for it. Not worth pursuing until
there's an actual zap-less venue in scope to route for.

## Normalized `tokens` table for asset metadata (decimals, ticker, etc.)

**Idea:** a `tokens` table keyed by asset unit (`policyId+hexname`, or
`"lovelace"`), storing metadata that's a property of the *asset* itself —
decimals today, potentially ticker/display name/logo later — instead of
implicitly re-deriving or re-fetching it once per pool row that happens to
include that asset.

**Deferred, not abandoned** — surfaced 2026-08-05 while wiring real wallet
balances into the deposit modal's input step (`docs/workflows/zap-in.md`),
which needed each asset's decimal count to convert a raw on-chain integer
into a human-readable number. Went with a live Blockfrost lookup (`GET
/assets/{unit}`, cached client-side via TanStack Query with `staleTime:
Infinity` — decimals are immutable once an asset is minted) instead of a
persisted table:
- ADA itself never needs a lookup at all (6 decimals is a fixed protocol
  constant) — the actual duplication risk is only each pool's *second*
  asset.
- TanStack Query's own client cache, keyed by unit, already deduplicates
  repeat lookups for a shared asset within a session — a backend table
  would only additionally help *cross-session*/*cross-user* repeats, not a
  proven problem yet.
- A real table brings design questions not yet justified: what belongs in
  it beyond decimals, who populates it (the Python discovery pipeline vs. a
  lazy write from the web app on first lookup), whether existing `pools`
  rows get backfilled.

**Revisit trigger:** real evidence that repeated cross-session Blockfrost
calls for the same well-known assets become a cost/latency problem, or
token-metadata needs grow past decimals alone — e.g. wanting a real
ticker/logo shown in the deposit modal instead of the current
string-split-from-`pool.pair` hack used for the amount field labels.

## Richer insufficient-funds diagnostics (cause-bucketing, itemized total)

**Idea:** when a real deposit build fails with `InsufficientBalanceError`,
go beyond "which asset, how much short" (what's shown today,
`docs/workflows/zap-in.md`) to a fuller diagnosis: bucket the SDK's own
`InsufficientBalanceCause` enum (`@minswap/internal-sdk`, real and
finite — `INPUTS`, `COLLATERAL`, `CHANGE`, `CHANGE_SPLIT`, `FEES`,
`OUT_CHANGE`, `OUT_FEE`) into a small number of user-facing categories
(e.g. min-ADA/UTxO-value family vs. fee family vs. "just not enough"), and
show an itemized "total required" breakdown — fixed costs + the shortfall
itself as a line item — instead of one sentence.

**Deferred, not abandoned** — surfaced 2026-08-05/06 while building the
current per-asset routed messaging (`docs/workflows/zap-in.md`). Only
`CHANGE_SPLIT` has been directly confirmed by actually triggering it; the
rest are reasoned from naming/context, not verified one-by-one, and
`COLLATERAL` may be unreachable for a plain deposit-order build in the
first place (creating an order is a payment to a script address, not a
script spend). Building a bucketing UI on five unverified enum members
felt like more precision than the current dev stage warrants.

**Confirmed, not just assumed, while investigating this:** no network fee
is available on a failed build — reproduced directly (`debugInfo.txFee:
{calculatedFee: '0', cslFee: '0'}` on a genuine `InsufficientBalanceError`)
— the build aborts during change-out/input selection, before fee
calculation ever runs. Any future itemized total could never include a
real fee on the failure path, only the flat platform costs
(`CostBreakdown`) plus the shortfall figure itself.

**Revisit trigger:** real user confusion with the current single-message
per-field/bottom approach, or enough live-triggered cause diversity (beyond
just `CHANGE_SPLIT`) to bucket with confidence instead of guessing at the
untested enum members' actual behavior.
