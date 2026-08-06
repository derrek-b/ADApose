# Workflows

Design-level walkthroughs of every action path the app implements — pseudo-code at
most, no source. Each doc lays out: the actors and components touched, the on-chain
checks, the step-by-step processing logic, and every failure branch inline with its
recovery.

These sit between `docs/decisions.md` (why) and the eventual source (how) — a
workflow doc is the implementation contract for its path. If writing one surfaces a
design gap, the doc flags it in **Open design points** and the resolution goes to
`decisions.md` as a D-entry; workflows never silently override decisions. Same
convention `legacy/docs/workflows/` used — see that tree's own `README.md` if a
comparison against the old architecture's shape is useful.

## Evidence conventions

Same as before: every API/contract claim carries a tag — ✅ **VERIFIED** (proven
against a real chain, vendored source, or a live endpoint, citation given) or
⚠️ **UNVERIFIED** (assumed shape, needs confirming before it's trusted).

## Relationship to `docs/adapose-sqrtk-vault-brief.md`

The brief was the bridge document that carried the √k mechanism proposal from
first draft to technical review — not the permanent design record. As each piece
of it gets designed out properly, it moves here (or to `docs/mechanism-sqrtk.md` /
`docs/fee-crystallization.md`, the two cross-cutting docs that sit next to this
directory rather than inside it, same as `docs/dex-adapters.md` always has) and
gets removed from the brief. The brief should end up thin — market justification
and the value-prop argument, pending their own `decisions.md` entries — everything
mechanism-shaped belongs in one of the docs below instead.

## Index

| Doc | Path | Status |
|---|---|---|
| [mechanism-sqrtk.md](../mechanism-sqrtk.md) | The √k invariant, what the vault reads on-chain, share issuance, non-custodial constraints (draft) | drafted, several open points |
| [fee-crystallization.md](../fee-crystallization.md) | Vault-level HWM, crystallized on every supply change | drafted, several open points |
| [rebalance.md](rebalance.md) | Cross-pool rebalance: crystallize → burn → swap → zap → re-base, guardrails, mid-flight state | drafted, several open points |
| [deposit.md](deposit.md) | User deposit / share issuance mechanics | stub — the actual deposit flow shape is undecided |
| [redeem.md](redeem.md) | User redemption / in-kind payout | stub — thin brief coverage, mostly the non-custodial principle |
| [zap-in.md](zap-in.md) | v1's no-vault Minswap deposit (D28 addendum) — running notes, not a contract doc | in progress |
