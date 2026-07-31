<!-- Source: legacy/validators/validators/vault.ak -->
# Workflow: Emergency Withdraw (trustless farm exit)

**Path:** farm position (entire) —self-built `EMERGENCY_WITHDRAW` tx→ executor
address —`ExitFarm`→ vault UTXO → aftermath decision (per-reason).
**Decisions:** D19 (constructor 3, owner-only — the trustless-exit guarantee),
D18 (custody envelope), D20 addendum 2026-07-19 (ExitFarm), policies 2026-07-23
(return-to-vault unconditional; aftermath per-reason).
Evidence tags per `README.md` — ✅ verified / ⚠️ unverified. This is the floor
under every Minswap dependency in the system: the reason "co-sign API down" means
*delay*, never *lockup*.

## What it is

Trustless exit of the **entire** executor-keyed farm position. On-chain facts
(✅ from our UPLC decode, `reference/farm-onchain/`; ⚠️ no executed tx yet —
dust-cycle item (b) is exactly this): the farm redeemer at constructor index
**3** authorizes a spend on `txSignedBy(ownerPkh)` **alone** — no Minswap
co-signature in the authorization path. Properties:

- **All-or-nothing:** the position is fully spent; no partial emergency exit.
  The position ceases to exist → the enter-path existence predicate flips
  (next stake, if ever, is a `buildFirstDepositV2` — enter-exit-farm.md).
- **Forfeits all pending (unharvested) emissions** — ⚠️ per Minswap's statement
  (vendored doc §2); staked LP + any functional NFTs return, rewards don't.
  Nothing to record on the vault: the datum totals never knew about pending
  emissions (N1) — RecordHarvest only ever records *landed* LP. (Stub-era open
  question, now answered by construction; confirm incidentally at dust time.)
- Landing zone: the **executor address** — not user wallets (N5), not the vault
  directly (same two-hop reality as every crossing).

## The two build variants — we engineer only one

The vendored doc (§2) offers two ways:

- **(a) Via the API** (`buildEmergencyWithdrawV2` — ✅ schema): convenient,
  Minswap sponsors the Plutus collateral. **Useless to us as an emergency
  tool:** it requires their API to be up — but if their API is up, the normal
  co-sign withdraw path works and no emergency exists. An emergency tool that
  depends on the counterparty it's an escape from isn't one.
- **(b) Fully self-built** — spend the position UTXO with redeemer constructor
  3, pay all value to the owner (executor address), supply our own collateral,
  sign with the owner key only. Zero Minswap involvement. **This is the variant
  we engineer, test (dust-cycle (b)), and keep on the shelf.** It's also the
  only variant that serves the farm-exploit and co-sign-refusal triggers.

## Triggers (policy — admin/extraordinary only)

- **No user action, redeem order, or queue depth fires this** — users hold
  Cancel and a redemption claim, never this trigger (N4/N5).
- **Named escalation rung** (redeem.md Step C tier 3): sustained co-sign-API
  outage with redemptions queued → treasury-authorized emergency withdraw →
  ExitFarm → service the queue. Naming this rung is what makes the buffer-miss
  co-sign dependency an honest *delay* risk instead of a potential lockup.
- Other qualifying circumstances: Minswap farm exploit/compromise; executor key
  incident; venue wind-down. (Aftermath differs per trigger — table below.)
- **The unifying condition: co-sign unavailable, untrusted, or refused.**
  If co-sign works and is trusted, the normal path is strictly better — e.g.
  venue wind-down with a healthy API = harvest, then co-signed withdraw-all,
  forfeiting nothing; emergency is wind-down's tool only if co-sign has failed.
- **Why forfeiture is structural, not punitive:** pending emissions are never
  in the position UTXO — they're accounting against Minswap-controlled reward
  reserves, paid only by a harvest (which spends THEIR funds, hence their
  co-sign). Constructor 3 is owner-only precisely because it touches only our
  staked value; an exit that touched their reserves couldn't be trustless.

## Steps

1. **Authorize** — treasury decision per runbook (who/how = open point 1; this
   is a treasury action gating an executor-key signature: treasury decides,
   the executor key must sign the spend — it's the position owner).
2. **Build (self-built, our code):** input = the farm position UTXO (located by
   owner + LP asset); redeemer = constructor 3; outputs = all position value →
   executor address; collateral = executor wallet; validity window tight.
   ⚠️ exact position-datum/redeemer CBOR shape from our decode — dust test is
   the proof.
3. **Verify** — D19 discipline applies to our own builds too: intent = exactly
   the position input, all value to the executor address, no other signers
   needed, fees sane. Fail closed.
4. **Sign (executor key) + submit.**
5. **Return to vault — immediately:** `ExitFarm` with the full amount
   (`farmed_lp` −= entire position; solvency holds; ledger true again). The
   withdraw + ExitFarm pair should be **pre-built together and submitted
   back-to-back** — this is one unit ("get it home and make the ledger true"),
   and in the key-incident scenario it's a race (below).
6. **Aftermath** — per-reason decision (table), made only after the LP is safe
   in the vault. **Re-staking is never automatic.**

**In-flight note:** the entire position transits the executor address between
steps 4 and 5 — this blows through `MAX_INFLIGHT_LP` by nature (that cap
governs routine crossings). The mitigation is not the cap but the pairing:
minimal window, pre-built ExitFarm, D18's envelope as the backstop.
**Implementation constraint:** the cap must be scoped to *initiating routine
crossings* (a scheduling gate), never to completing one — a naive
`amount <= MAX_INFLIGHT_LP` assert in shared crossing code would block the
emergency ExitFarm at the worst possible moment.

## Value path — return-to-vault is unconditional (policy, 2026-07-23)

farm position (entire) → executor address → `ExitFarm` (vault value += LP,
`farmed_lp` −= exact amount, `total_lp` unchanged) → vault-held LP; redemptions
then proceed normally. **The withdraw + ExitFarm pair is one unit** — regardless
of what triggered the emergency:

1. **Ledger honesty:** until ExitFarm lands, the LP sits at the executor address
   with `farmed_lp` still counting it — fine as a bounded in-flight state, a lie
   if it persists (proof-of-reserves alarms; `liquid?` gates redemptions on
   vault-held LP).
2. **Custody quality:** the vault is validator-guarded; the executor address is
   a bare hot key (Tier-3, the worst zone). Every emergency reason makes you
   MORE risk-averse — never park the pool at the bare key.

Terminology: "return to vault" = the ExitFarm leg (unconditional).
"Re-stake" = going back into the farm — a separate, reason-dependent aftermath
decision that after an emergency usually does NOT happen (whatever caused the
emergency is the reason not to re-stake).

The trustless exit lands at the **executor key**, not user wallets — N5;
capped-capital + MPC (D18) remain the standing answer.

## Aftermath by trigger (decided after the LP is safe in the vault)

| Trigger | After return-to-vault |
|---|---|
| Sustained co-sign outage | stay unfarmed, service redemptions; note re-staking needs the API too — pool earns trading fees only until Minswap recovers |
| Farm exploit/compromise | stay unfarmed until audited / permanently — venue decision. (AMM-itself compromise is beyond this doc: LP tokens are the problem; wind-down/redeem-out territory) |
| Executor key incident | return-to-vault becomes a RACE — a compromised key can sweep the executor address or fire the withdraw itself. Defender's edge is preparation: withdraw + ExitFarm pre-built, submitted back-to-back. D18 capped capital is the real bound (a stolen key was always total-exposure in any design) |
| Venue wind-down | stay unfarmed → users redeem out, or v2 re-deploys via another venue's adapter |

## Failure branches

- **Verifier rejects our own build** → nothing signed; fix the builder, retry.
  (Fail-closed applies to self-built txs same as API-built.)
- **Position already spent when our tx lands** → in the key-incident race, the
  attacker got there first — D18 territory (capped capital); in any other
  scenario, a concurrent normal withdraw landed — re-derive from tip, the
  emergency may be moot.
- **Rollback** → stateless re-derive, resubmit the pair.
- **ExitFarm delayed after withdraw landed** → LP at the executor address with
  `farmed_lp` counting it — proof-of-reserves reads in-flight, not shortfall;
  retry ExitFarm (depends on nothing external).

## Open design points

1. **Authorization mechanics** — who/how for "treasury-authorized" (single
   sig? threshold? written runbook?) — consumes vault-init.md's treasury-form
   decision; plus: is the pre-built withdraw+ExitFarm pair kept perpetually
   fresh (re-derived on every position change) as key-incident readiness, or
   built on demand?
2. **User comms/UI during the event** — what the web shows while the pool is
   unfarmed / mid-emergency (ties to N5 copy discipline; design with the web).
