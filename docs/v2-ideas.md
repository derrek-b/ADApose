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
