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
