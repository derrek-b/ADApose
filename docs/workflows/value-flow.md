<!-- Source: validators/validators/vault.ak -->
# Value Flow — quick guide to UTXO & value movement per workflow

Study companion to the per-workflow contracts (deposit.md, redeem.md, …) — those
docs define the checks; this one just maps where value physically moves, tx by tx.
Every arrow below is one transaction, labeled with who builds and signs it.

## The custody ladder

LP tokens only ever sit in one of four zones, and every workflow is a walk up or
down this ladder — never a skip:

```
  user wallet
      │  (user-signed txs)
  Minswap order UTXO          zone 1 — batcher-fill pending; refundable to user
      │  (Minswap batcher)
  our order validator UTXO    zone 2 — user-cancellable anytime (N4)
      │  (executor: ApplyOrders)
  vault UTXO                  zone 3 — pooled, datum-tracked; the unfarmed buffer
      │  (executor: EnterFarm / ExitFarm)
  farm position               zone 4 — executor-keyed Minswap position (D18 zone)
```

Two pairs of moves, never mixed in one tx:
- **ApplyOrders** moves value between **order UTxOs ↔ vault** (both directions in
  one batch), touching `total_lp` / `total_shares`.
- **EnterFarm / ExitFarm** move value between **vault ↔ farm**, touching
  `farmed_lp` only (custody move, never a rate event).

That separation is why `total_lp` and `farmed_lp` are separate datum fields.

Vault spends never share a tx (one spend, one redeemer) — they chain, one in
flight per pool, in precedence order (D21 addendum): **RecordHarvest → ExitFarm +
the batch it unblocks → other ApplyOrders → EnterFarm.**

## Deposit (assets in → shares out) — deposit.md

Example: user deposits ADA into the NIGHT/ADA vault.

1. **User signs** (web-built): ADA → **Minswap DEPOSIT order UTXO** at Minswap's
   order validator, carrying `successReceiver` = our order validator +
   `successReceiverDatum` = our deposit datum. No LP exists yet. (A mixed deposit
   adds a second output in this same tx: an LP-leg order UTXO directly at our
   order validator.)
2. **Minswap batcher fills**: spends the order against the pool; LP is minted; the
   fill output lands at **our order validator** — value {min-ADA + LP}, our inline
   `OrderDatum`. Delivery is on-chain enforced (`validate_order_receiver`).
3. **Executor: `ApplyOrders`** — one tx spends the vault UTXO (redeemer
   `ApplyOrders`) + eligible order UTxOs (redeemer `Apply`). LP moves into the
   vault's value; `total_lp` += Σ lp_i; shares are **minted** to each user's
   payout address (pass-through: order extras return too). LP is now vault-held,
   **unfarmed**.
4. **Executor: `EnterFarm`** (separate, later, policy-driven): vault-held LP above
   the `BUFFER_PCT` buffer line moves into the executor-keyed farm position via
   the D19 co-sign path; `farmed_lp` += that amount, `total_lp` unchanged.

## Redeem (shares in → LP out) — redeem.md

1. **User signs** (web-built): share tokens → **redeem order UTXO at our order
   validator** — value {min-ADA + shares}, datum `action: Redeem`. Cancellable
   until applied (N4).
2. **Executor: `ApplyOrders`** — same tx shape as deposits; the farm position is
   NOT an input. In one tx: shares are **burned**; the continuing vault' UTXO has
   value −= Σ assets_i LP, datum `total_lp` −= Σ assets_i, `total_shares` −=
   Σ shares_i; each payout output goes **straight to the user's wallet carrying
   LP tokens**. Done — v1 pays LP out.

Optional follow-up (user ↔ Minswap only, never through us): a user-signed Minswap
WITHDRAW order converts LP → NIGHT + ADA in the user's own wallet.

**Buffer miss** (batch needs more LP than the vault holds unfarmed) — two prequel
txs before step 2 can run:

1. **Executor: farm-API withdraw** (Minswap co-signs): farm position shrinks; LP
   lands at the executor's address.
2. **Executor: `ExitFarm`**: that LP re-enters the vault's value; `farmed_lp` −=
   exact amount, `total_lp` unchanged.
3. Then the normal `ApplyOrders` above.

The buffer itself: `BUFFER_PCT` of `total_lp` deliberately left unfarmed so
common-case redemptions never depend on Minswap's API — executor policy, not an
on-chain guarantee; sizing and cost tradeoff in redeem.md Step C.

## Compound cycle (emissions → more LP) — compound-cycle.md (planned)

Multi-tx by design (D18/D19); the vault is only touched at the final step.

1. **Executor: farm-API harvest** (Minswap co-signs): accrued MIN emissions leave
   the farm → executor's address.
2. **Executor: Minswap SWAP order(s)**: MIN → pool assets (NIGHT/ADA); batcher
   fills back to the executor.
3. **Executor: Minswap DEPOSIT order**: pool assets → new LP; batcher fills back
   to the executor.
4. **Executor: farm-API stake** (Minswap co-signs): new LP → farm position.
5. **Executor: `RecordHarvest`** — the only vault spend in the cycle, and it moves
   **no value**, only the ledger: `total_lp` += ΔLP, `farmed_lp` += ΔLP, and
   treasury shares (fee_bps of the gain) are minted. This is the only transition
   that moves the exchange rate.

Note steps 1–4 happen entirely in zone-4/executor custody — user-facing value in
the vault and order UTxOs is never an input to the cycle.

## Vault init (one-time) — vault-init.md (stub)

One-time mints, no user value: create the vault UTXO with init datum + **thread
NFT (N6)** + dead shares (N2) to an unspendable output + CIP-68 `(100)` reference
NFT to treasury; publish reference scripts. Details TBD in vault-init.md.

## Emergency withdraw (trustless floor) — emergency-withdraw.md (stub)

Owner-only Minswap farm exit (`EMERGENCY_WITHDRAW`, constructor 3 — no co-sign
needed): the **entire** farm position → executor's address, forfeiting pending
emissions. Re-enters the vault via `ExitFarm` (same as a buffer miss), after which
redemptions proceed normally. Triggers are admin/extraordinary only — including,
by policy, a sustained co-sign-API outage with redemptions queued (the escalation
rung in redeem.md Step C); no user action or queue depth fires it automatically. Note the trustless exit lands at the **executor
key**, not user wallets — N5 honesty; D18 mitigations are the answer.

## Cancel & Rescue (recovery paths)

- **Cancel** (user-signed, anytime, zone 2): order UTXO → its full value back to
  the canceller. Never executor-dependent (N4).
- **Rescue** (treasury-signed, D10): only UTxOs whose datum fails to cast — value
  to treasury as a backstop for bricked sends. Real orders are never rescuable.
