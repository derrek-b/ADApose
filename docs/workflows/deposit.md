<!-- Source: none yet -- see docs/mechanism-sqrtk.md's own note. -->
# Workflow: User Deposit

**Stub.** The actual deposit *flow* shape — order-queue-style like `legacy/`'s
own N4 pattern, or something else entirely — is explicitly undecided
(`docs/decisions.md` D26's own "not yet decided" list). This doc exists so the
directory structure is ready and the one piece of deposit mechanics the brief
did cover has a real home, not so it can be treated as designed.

## What's actually designed so far

The share-issuance math (`shares minted = Δ(vault √k) ÷ (√k per share)`) and its
worked example live in `docs/mechanism-sqrtk.md`, not here — that's the pricing
mechanism, shared by every path that changes share supply
(`docs/fee-crystallization.md` covers the fee side of the same mint). This doc
is meant to eventually hold the *transaction shape* around that math: what a
user actually signs, what the executor or validator does with it, what UTxOs
move where — none of which exists yet.

## Open design points

1. **Two-phase deposit, and whether it's even the right shape (brief Q3).**
   Batcher latency means a DEX order fills at an unknown later block. The
   brief's proposed shape: submit order → observe the LP delta at execution →
   mint shares at execution-time `√k per share`. What holds the user's claim in
   between, and what happens if the order fails or is refunded? `legacy/`'s own
   N4 order-queue pattern (owner-cancellable order UTxOs, executor-batched) is a
   plausible starting point given it already solved a structurally similar
   problem, but nothing says it transfers cleanly — the accounting model here
   (vault-level HWM, not batch-rate share minting) is different enough that it
   needs checking, not assuming.
2. **Vault UTxO contention (brief Q5).** A single vault UTxO is a contention
   bottleneck — concurrent deposits in the same block will conflict. What's the
   right pattern: a batched deposit queue (matching `legacy/`'s N4 shape again),
   per-epoch aggregation, something else? Flagged in the brief as possibly "the
   hardest part of the build" — worth taking that seriously rather than
   assuming a known pattern ports over for free.
