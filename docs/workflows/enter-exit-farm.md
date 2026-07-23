<!-- Source: validators/validators/vault.ak -->
# Workflow: Enter/Exit Farm (the vault ↔ farm custody boundary)

**Path (enter):** vault UTXO —`EnterFarm`→ executor address —co-sign API stake→
farm position. **Path (exit):** farm position —co-sign API withdraw→ executor
address —`ExitFarm`→ vault UTXO.
**Decisions:** D19 (co-sign API + verifier discipline), D20 + addenda 2026-07-19
(ExitFarm, solvency), D18 (custody envelope), D3 (trigger cadence context).
Evidence tags per `README.md` — ✅ verified / ⚠️ unverified. One doc for both
directions: they are mirrors sharing all machinery; only triggers and deltas
differ. Neither direction is a rate event — `total_lp`, `total_shares`, and the
exchange rate never move here (custody moves only).

## The forced two-hop shape (the load-bearing finding)

The farm API builds transactions **server-side** and returns co-signed CBOR
(`String!` — the tx already carries Minswap's farm-key signatures; we add the
owner signature and submit). Its input selection is `inputsToChoose`: "**Owner
UTxOs** that may be spent in the transaction" (✅ schema verified live +
vendored: `reference/farm-docs/minswap-farm.md`). A vault script UTXO is not an
owner UTXO — spending it needs our redeemer + script witness, which a server-side
builder doesn't know how to attach. Consequence, both directions:

**The vault spend and the farm spend cannot be one transaction.** Each crossing
is two txs with the executor's address as the midpoint:

```
ENTER:  tx1 (ours)  vault —EnterFarm→ executor addr     farmed_lp += X
        tx2 (API)   executor addr —buildStakeDepositV2→ farm position
EXIT:   tx1 (API)   farm position —buildStakeWithdrawV2→ executor addr
        tx2 (ours)  executor addr —ExitFarm→ vault      farmed_lp −= X
```

⚠️ "Cannot" is inferred from the schema, not yet proven — confirm during the
D19 dust cycle (week1-verify item (e)); if a script input CAN ride along, the
single-tx shape is strictly better and this doc gets a superseding pass.

**What the two-hop costs — the in-flight custody window:** between hops, X LP
sits at the executor's bare address — pure Tier-3 custody, the D18 zone, with no
validator watching it. Bounded by policy: `MAX_INFLIGHT_LP` caps X per crossing,
and the executor never starts a second crossing (either direction) while one is
in flight per pool. The window is minutes long in the happy path.

**What this means for `farmed_lp` semantics (refinement):** the sub-ledger
increments when LP *leaves the vault* (enter tx1) and decrements when LP
*re-enters* (exit tx2) — so `farmed_lp` precisely means **"LP outside the vault
under executor farm-custody"** (farm position + any in-flight remainder), not
"LP currently staked." This keeps the on-chain identity exact (vault-held LP ==
`total_lp − farmed_lp` by value conservation) and tells the proof-of-reserves
monitor what to check: `farmed_lp == farm position LP + executor-address LP
in flight` (transient mismatch during a crossing is expected and bounded).

## Components touched

| Component | Role |
|---|---|
| executor `service/scheduler` + `operations/` | fires triggers, sequences the two hops, tracks in-flight state |
| vault validator — `EnterFarm` / `ExitFarm` | our tx of each crossing: exact-amount ledger move, NFT continuity, solvency |
| Minswap farm GraphQL API (D19) | builds + co-signs the farm tx; mutations below ✅ schema, ⚠️ operational |
| CBOR verifier (D19, outside adapter boundary) | every API-built tx re-parsed against intent BEFORE the owner key signs |
| `adapters/minswap_v2` | wraps the GraphQL calls, returns standardized shapes (D22) |

## Shared machinery (both directions)

- **API conventions** (✅ vendored doc): every mutation returns bare CBOR-hex,
  co-signed; `amount` = raw LP units; `hasLBBonus: false` for standard farms;
  `collateralUtxos` from the executor's wallet. Normal farm spends carry
  required signers = owner + Minswap keys.
- **Verifier intent, API-built txs** (the D19 gate, fail closed): spends only
  expected executor UTxOs + the farm position; farm position delta == the
  requested `amount` exactly; all non-farm value returns to the executor
  address; no unexpected outputs, no signer beyond {executor, Minswap keys};
  for exit: withdrawn LP lands at the executor address. Verify BEFORE adding
  the owner signature — an unsigned co-signed tx is inert.
- **Vault-tx named checks** (ours; mirror images):
  ```
  enter_exact / exit_exact   LP leaving (entering) vault == farmed_lp delta, exactly
  solvency                   0 <= farmed_lp <= total_lp after the move
  n6 continuity              thread NFT in the continuing vault output
  no_other_movement          nothing but the LP amount (and the ledger field) changes
  auth                       executor-signed
  ```
  ⚠️ open question below: should `EnterFarm` also pin the destination address?
- **Sequencing:** vault spends can never share a tx — one tx spends the vault
  UTXO exactly once, with exactly one redeemer — so per-pool serialization is
  physical: each vault tx chains off the previous one's output, one in flight
  per pool (deposit.md Step E). Queue precedence (D21 addendum 2026-07-23):
  **RecordHarvest (when triggered) → ExitFarm + the ApplyOrders it unblocks →
  other ready ApplyOrders → EnterFarm.** Exit outranks only as a *prerequisite*
  of the batch it serves; enter is lowest system-wide — and the enter surplus
  computation must count eligible pending redeem orders first, or an enter can
  manufacture a buffer miss for a batch seconds from firing.

## ENTER — when and how

**Trigger (policy):** after an ApplyOrders lands, if
`vault_held := total_lp − farmed_lp` exceeds `buffer_target + MIN_ENTER_CHUNK`,
enter the surplus above `buffer_target` (redeem.md's `BUFFER_PCT`).
`MIN_ENTER_CHUNK` is the anti-churn floor — each crossing costs two txs in fees,
so dribbles wait. No urgency exists: unentered LP is safe in the vault and earns
trading fees; only emissions are deferred.

1. **tx1 — `EnterFarm`** (ours, Lucid-built, verified, executor-signed): vault
   value −X LP → executor address; datum `farmed_lp += X`.
2. **tx2 — API stake:** query the live position first, then
   `buildStakeDepositV2` (`amount: X`) if one exists, else `buildFirstDepositV2`
   (✅ separate mutation; fails if a position exists — one position per owner
   per pool, the D20 forcing fact). The existence query is permanent, not
   bootstrap-only: withdraw-all/emergency destroy the position (Open point 3,
   resolved). Verify → owner-sign → submit.

**Failure branches (enter):**
- **API down/refuses at tx2** → X sits at the executor address (in-flight
  custody, capped). Retry tx2; nothing else proceeds for this pool. If the
  outage is long, `ExitFarm` can return X to the vault (the crossing reverses
  cleanly — same ledger field, opposite sign).
- **tx1 rollback after tx2 built** → the verifier's input refs no longer exist;
  tx2 fails harmlessly. Re-derive from chain tip (indexer is stateless-resume,
  deposit.md branch).
- **Wrong mutation state** (first-stake vs stake-more mismatch) → API error at
  build time, nothing signed; flip mutation and retry.

## EXIT — when and how

**Triggers (policy):** (a) **buffer miss** — a redeem batch needs more than
vault-held LP (redeem.md Step C); (b) **buffer restore** — wait-for-deposits only in v1;
(c) **emergency unwind** — the whole position via the trustless path
(emergency-withdraw.md; lands at the executor address and returns to the vault via the
same `ExitFarm`, so exit-tx2 machinery is shared — return-to-vault is
unconditional; re-*staking* afterward is a separate per-reason decision, see
that doc).

1. **tx1 — API withdraw:** `buildStakeWithdrawV2` (`amount: X`) — ✅ partial
   withdraw is first-class; constraint: remaining balance must stay **> 0**
   (withdrawing everything = `buildStakeWithdrawAllV2` instead — the executor
   picks the mutation by comparing X to the live position). Verify →
   owner-sign → submit; X lands at the executor address.
2. **tx2 — `ExitFarm`** (ours): executor address −X LP → vault value;
   datum `farmed_lp −= X`. The waiting redeem batch's `liquid?` gate now
   passes; ApplyOrders proceeds.

**Failure branches (exit):**
- **API down at tx1** → the three-tier story (redeem.md Step C): redemptions
  queue against the remaining buffer; sustained outage escalates to emergency
  withdraw by policy. Users' Cancel is untouched throughout.
- **tx1 lands, tx2 delayed** → X at the executor address with `farmed_lp` still
  counting it (correct per the semantics above); proof-of-reserves sees
  in-flight, not shortfall. Retry tx2 — it depends on nothing but us.
- **Withdraw amount races a concurrent harvest** (position balance changed
  between quote and build) → API builds against live position state; verifier
  intent uses the API-returned tx's actual delta, and `ExitFarm`'s X follows
  the *landed* tx1 amount, never the quote.

## Open design points

1. **`EnterFarm` destination check** — vault.ak's sketch says value may "ONLY
   move to the farm path," written before the two-hop finding; the real
   destination is the executor address. Options: pin `destination ==
   EXECUTOR_ADDR` as a named check (cheap; catches honest-executor misroutes;
   worthless against a stolen key — that's D18's job), or drop to
   amount-exactness only. **Deferred 2026-07-23 to vault-init.md's key-encoding
   question** (pinning names the executor address in the validator — same
   parameter-vs-datum coupling as the keys; one decision, not two). Leaning:
   pin it. The sketch text needs the two-hop revision either way (pending that
   decision).
2. ~~**Buffer-restore policy.**~~ **RESOLVED 2026-07-23** — v1 is
   **wait-for-deposits**: exit crossings withdraw exact X; deposits rebuild the
   buffer for free (the EnterFarm skim line only takes the surplus *above*
   target). Piggybacking a restore amount is only cheaper in a sustained
   net-outflow regime, and its worst-case absence costs one extra crossing's
   latency, not funds. The adaptive refinement (restore-on-negative-flow +
   dynamic sizing) is parked in `../v2-ideas.md` ("Adaptive buffer
   management"); BUFFER_PCT's v1 starting value remains a plain
   constant-picking task (redeem.md Open point 3).
3. ~~**First-stake timing.**~~ **RESOLVED 2026-07-23 — lazy, at the first real
   enter.** The mutation choice (`buildFirstDepositV2` vs `buildStakeDepositV2`)
   is a **permanent runtime predicate**, not a bootstrap condition:
   withdraw-all and emergency withdraw destroy the position, so "position
   exists?" must be queried live before every enter regardless of what init
   did. Init-time staking would add treasury seed capital + an unverified
   zero-amount question for a benefit that doesn't exist. No first-depositor
   exposure: the farm position is a flat (owner, amount) record — no share
   ratio, and adds are owner+Minswap-gated (no donations). Vault-init gains NO
   farm duty; the vault-layer inflation attack is N2's job at init, unrelated.
4. **`MAX_INFLIGHT_LP` / `MIN_ENTER_CHUNK` values** — config constants
   (`shared/`), sized with the cost model (fees per crossing vs. emissions
   deferred vs. custody-window exposure). Placeholder until dust-cycle numbers.
