<!-- Source: validators/validators/vault.ak -->
# Workflow: User Redemption

**Path:** user wallet (share tokens) → redeem order UTXO at our order validator →
executor `ApplyOrders` batch (shares burned) → LP tokens in user wallet.
**Decisions:** D21 (order machinery, shared with deposit), D20/D20-N, D19, D10.
Evidence tags per `README.md` — ✅ verified / ⚠️ unverified. Mirrors `deposit.md`;
only differences and redeem-specific machinery are elaborated here.

## What redeeming means (and doesn't)

Burning `shares_i` pays out `assets_i = floor(shares_i × total_lp / total_shares)`
LP tokens — the holder's proportional cut of everything **recorded**: principal plus
every harvest that has hit `RecordHarvest`. **Pending (accrued-but-unharvested) farm
emissions are NOT included** — they aren't in the datum totals, and pricing them at
redeem time would mean reading farm state instead of datum truth (N1 forbids it).
Forfeited pending yield stays with the pool → accrues to remaining holders at the
next harvest (house-favored, N3's philosophy). Two softeners: harvest-priority
sequencing (D21 addendum) means a fired trigger's harvest lands *before* pending
redemptions (redeemers are paid the yield they sat through); and the weekly cadence
cap bounds what any exit can forfeit to ≤ one accumulation window.

**v1 pays out LP tokens**, not raw assets. Converting LP → NIGHT+ADA is a Minswap
WITHDRAW order the web offers as an optional follow-up tx (user-signed, to the
user's own wallet — never touches us). A one-signature chained exit (ApplyOrders
payout output *is* a Minswap withdraw order) is possible in principle but
complicates the n4 payout equation — parked as Open point 2.

## The redeem/deposit asymmetry (satisfiability)

Compounds only ever RAISE LP-per-share. For deposits that meant a missed
`min_shares` floor never recovers (terminal). For redemptions it's inverted:
`assets_i` per share only **rises** over time, so a `min_out` quoted at the current
rate stays satisfiable forever (a redeem order can only become *more* generous to
its owner while it waits). Consequences:
- Default tolerance for redeem quotes can be ~0 — no harvest can break the floor.
- Stale quotes are harmless; the DOA machinery deposit.md needed (tolerance floor,
  re-quote-at-sign, trigger-imminent warning) has no redeem counterpart.
- An `unsatisfiable?` redeem order signals a *bug or hand-crafted floor*, not rate
  drift — the executor skips it (never spends-without-serving, n4) and the UI
  offers Cancel.

## Components touched

Same as deposit.md minus the Minswap order leg (no batcher, no fill latency;
Minswap appears only as the co-sign API on buffer misses — Step C), plus one new
dependency: **the executor-keyed farm
position** as the liquidity source when the vault's unfarmed buffer can't cover a
batch (Step C).

## Step A — user places the redeem order (web, one signature)

1. Connect wallet; locate vault by thread NFT (N6); parse datum.
2. **Quote:** `assets_est = floor(shares_in × total_lp / total_shares)`;
   `min_out = floor(assets_est × (1 − tolerance))`, tolerance default ~0 (see
   asymmetry above). Bootstrap precondition applies as in deposit.md.
3. **Build:** one order UTXO at the order validator:
   ```
   value:  { lovelace: minUTxO, [share_asset]: shares_in }
   datum:  { pool_nft, canceller, payout, action: Redeem, min_out, deadline }
   ```
   `shares_i` is **value-derived** — the share-asset amount in the order's value,
   never a datum claim (same gap-2 rule as deposits; `Redeem` carries no amount
   param). Deadline: `now + REDEEM_TTL`, floor = `T_max + margin`
   (+ `FARM_WITHDRAW_LATENCY` if the pool's buffer is thin — Step C; web reads
   buffer state and quotes the honest floor). No Minswap clock — one custody zone.
4. Sign + submit.

**Failure branches (A):** as deposit.md (vault-read hard-stop, wallet UX), minus
all Minswap branches.

## Step B — order on chain

Identical machinery to deposit.md Step B: Cancel (canceller-authorized, anytime,
returns shares + minUTxO) / Apply (pool_nft-anchored) / Rescue (cast-failure only).
Deadline semantics identical. The deadline-policy and value-handling rules carry
over unchanged.

## Step C — executor discovers + filters (the redeem-specific part: liquidity)

Eligibility mirrors deposit.md (`parses?`, `funded?` — share-asset amount > 0,
value-derived; `fresh?`; `satisfiable?` — near-vacuous, see asymmetry) **plus one
new gate:**

```
liquid?   Σ assets_i of the candidate batch ≤ vault-held LP (total_lp − farmed_lp)
```

The vault UTXO only holds **unfarmed** LP; the rest sits in the executor-keyed farm
position. Policy machinery this forces:

- **Unfarmed buffer:** the executor keeps `BUFFER_PCT` of `total_lp` out of the
  farm as a redemption buffer (config; sized to typical redemption volume — the
  tradeoff is buffer LP earns trading fees but no farm emissions). `EnterFarm`
  tops the farm up only above the buffer line.
- **Buffer miss:** a batch exceeding vault-held LP triggers a **farm withdrawal**
  first: farm-API withdraw tx (D19 co-sign path; ⚠️ unverified until the dust
  cycle) returns LP to the executor's address, then it re-enters the vault via
  **`ExitFarm`** (mirror of EnterFarm: vault value += LP, `farmed_lp` −= exact LP
  entering, `total_lp` unchanged — custody move, never a rate event; D20 addendum
  2026-07-19).
- **Latency & dependency honesty (three tiers):**
  1. **Common case** — a buffer-covered redemption touches only our machinery
     (order UTXO → ApplyOrders). No Minswap dependency of any kind.
  2. **Buffer miss** — extra txs (farm-API withdraw → ExitFarm → ApplyOrders),
     and the fast path adds **Minswap's co-sign API as an availability
     dependency**. UI states both plainly: "processing may take up to X; exits
     beyond the buffer require Minswap's API to be up."
  3. **Sustained co-sign outage** — **escalation policy, not a redeem
     mechanism:** treasury-authorized emergency withdraw (D19 — whole position,
     forfeits pending emissions; extraordinary by design) → ExitFarm → service
     the queue. Naming this rung is what makes tier 2 a delay risk rather than a
     potential permanent lockup — but it is admin-triggered; no user action or
     queue depth fires it.

  Through all tiers the N5-honest sentence holds: *a redemption is a claim the
  executor services end-to-end — users hold Cancel (shares back) and a claim,
  never a trigger; even the trustless emergency withdraw returns LP to the
  executor key, not to users — capped-capital + MPC mitigations (D18) are the
  standing answer.*

Sibling-hold has no redeem counterpart (one leg only). Batch trigger and
harvest-priority sequencing apply unchanged.

## Step D — ApplyOrders (redeem side)

```
inputs:   vault UTXO            redeemer ApplyOrders
          order UTxOs (1..n)    redeemer Apply
outputs:  vault' UTXO           value −= Σ assets_i
                                datum: total_lp −= Σ assets_i, total_shares −= Σ shares_i
          per order i:          order_value_i − shares_i×share_asset + assets_i×LP → payout_i
                                (pass-through: LP + min-ADA + any extras)
mint:     share_policy: −Σ shares_i   (burn)
validity: upper bound < min(deadline_i)
signers:  executor hot key
```

The payout line is the same generalized equation as deposits with consumed/granted
swapped — one rule both directions: `payout = order_value − consumed + entitlement`.

**Mixed deposit+redeem batches at the uniform pre-batch rate (ADOPTED — D20
addendum 2026-07-19):** both directions price at the same `(total_shares,
total_lp)`. A same-batch deposit+redeem round trip mints
`floor(lp·S/L)` shares and redeems them for `floor(floor(lp·S/L)·L/S) ≤ lp` — the
double floor guarantees ≤, i.e. a round trip always loses dust to the pool, never
gains. Deposits and redeems are each rate-neutral (proportional add/remove), so
batch composition doesn't move the rate either. No ordering games exist inside a
batch; uniform pricing is safe in mixed batches. (One rule to keep it true: totals
for the batch update as net sums; every order still prices at the PRE-batch rate.)

Validator checks (named, mirroring deposit.md's table): `n1_totals` (decrease exactly; vault LP delta == −Σ assets_i, no leak), `n3_round_down` (assets floor), `pool_scope`, `n4_full_service` (generalized payout equation; `assets_i >= min_out_i`; validity vs deadlines), burn gate (mint == −Σ shares_i, vault + NFT present). Plus redeem-specific: **`solvency`** — vault-held LP after payout ≥ 0 is enforced by value conservation automatically, but the datum identity `0 <= farmed_lp <= total_lp` must survive every transition (named check, paired with ExitFarm — D20 addendum 2026-07-19).

## Step E — build, verify, sign, submit

As deposit.md. Verifier intent for redeems adds: burn amount matches Σ value-derived
shares; every payout ≥ its `min_out`; vault LP outflow == Σ assets_i exactly; no
non-LP value leaves the vault (thread NFT + any riding ADA continuity).

**Failure branches (D/E):** as deposit.md (cancel-mid-build rebuild, rollback
re-derive, compound serialization, Blockfrost pause) plus: **farm-withdraw leg
fails mid-sequence** (API down / co-sign refused) → redemptions queue against the
remaining buffer; users' recourse unchanged (Cancel anytime); trustless floor is
emergency withdraw (D19) under D18's capped-capital envelope.

## Open design points

1. ~~**`ExitFarm` redeemer missing from vault.ak.**~~ **RESOLVED 2026-07-19** — D20
   addendum: ExitFarm added to the redeemer set (executor-signed mirror of
   EnterFarm; vault value += LP, `farmed_lp` −= exact amount, `total_lp`/rate
   unchanged; `solvency` named check `0 <= farmed_lp <= total_lp`). vault.ak +
   CLAUDE.md updated.
2. ~~**One-signature chained exit.**~~ **PARKED for v2, 2026-07-19** — v1 is
   decided: LP-out + optional user-signed convert. The idea, its costs (validator
   coupling to Minswap's order format; batcher dependency entering the redemption
   path), and its revisit trigger live in `../v2-ideas.md`.
3. **`BUFFER_PCT` sizing** — redemption-volume data doesn't exist pre-launch; pick
   a starting value (suggest 5–10% of total_lp) and revisit with real traffic.
   Interacts with the cost model (buffer LP earns no emissions).
4. ~~**Uniform-rate resolution above needs sign-off.**~~ **RESOLVED 2026-07-19** —
   signed off; D20 addendum recorded (double-floor round trip + rate-neutrality;
   sequential alternatives rejected). deposit.md Open point 3 struck.
