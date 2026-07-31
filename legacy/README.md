# Legacy — the farm-emissions auto-compounding vault (D1–D25, superseded by D26)

**This is a complete, coherent design and skeleton implementation, preserved
on purpose — not dead code, not cleanup pending deletion.** On 2026-07-30
(D26 in `docs/decisions.md`, the root design record) the company pivoted away
from this architecture as the active product: a real-numbers market-size
check found the farm-emissions revenue this design was built to harvest is
too small to support a business at any achievable market share. The pivot is
economic, not technical — nothing here was found to be broken. It's preserved
because auto-compounding may become viable again later, as an add-on to
whatever ships next or as its own thing, and rebuilding this from scratch
would mean re-deriving weeks of real design work that already happened once.

**Frozen as of the move.** Nothing in this tree is being maintained or
further edited going forward — it reflects exactly the state of the design
when D26 landed, on purpose, so it stays a trustworthy historical snapshot
rather than slowly drifting out of sync with itself. If this ever gets
revived, expect it to need a fresh design pass before trusting it as current
(chain state, dependency versions, and Cardano ecosystem facts it cites will
have moved on) — but the mechanism design, the invariants, and the reasoning
behind every decision should still be sound starting points.

## What's here

- `validators/` — the Aiken vault validator (Plutus V3): pooled single-vault
  design, N1–N6 invariants, `ApplyOrders`/`EnterFarm`/`ExitFarm`/`Rescue`
  redeemer set.
- `executor/` — the Node/TS off-chain service scaffold: chain indexer, tx
  builder, Minswap adapter, the compound-batch/scheduler/trigger stubs.
  Pre-build status when archived — `smoke-test.ts` was the only working code.
- `docs/workflows/` — the per-action implementation contracts: deposit,
  redeem, vault-init, enter/exit-farm, the compound cycle, emergency
  withdraw, rescue, proof-of-reserves, plus `value-flow.md` (the custody-zone
  study guide) and this directory's own `README.md` index.
- `docs/week1-verify.md` — the checklist of unproven assumptions this
  specific design leaned on (Minswap farm co-sign, batcher fill behavior,
  etc.) — most of these got resolved during the design process (see D19,
  D24); check status against the root `docs/decisions.md` before assuming
  anything on this list is still actually open.
- `docs/v2-ideas.md` — fourteen parked-feature entries specific to this
  architecture's order-queue, compound-cycle, and farm-custody mechanics.
  One entry (the dual-product-line question) is marked resolved by D26
  itself rather than left as a live open question.

## Where to start if this gets revived

1. Read `docs/decisions.md` (root) start to finish, or at minimum D16, D18,
   D19, D20, D20-N, D21–D25, then D26 for why this stopped being the active
   product. That file is the one continuous history — it was never split,
   so it explains both this design and the pivot away from it in one place.
2. Read `docs/workflows/README.md` (in this tree) for the workflow-doc index
   and evidence conventions, then whichever specific workflow doc is
   relevant.
3. Check `docs/v2-ideas.md` (in this tree) for anything already thought
   through and parked, before re-deriving a feature idea from scratch.
4. Everything citing a specific package version, live endpoint, or
   third-party contract behavior needs re-verification before being trusted
   — treat every ✅/⚠️ evidence tag in these docs as "true when written," not
   "true now."
