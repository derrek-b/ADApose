<!-- Source: validators/validators/vault.ak -->
# Workflow: Proof of Reserves (public custody monitor)

**Path:** public chain data → reconciliation checks → public feed/dashboard +
alerts. No transactions, no keys, no validator surface — read-only code.
**Decisions:** D18 (the mitigation this implements), D20-N (N5 — this is the
honesty machinery; N6 — how the vault is located), D20 addendum 2026-07-23
(`farmed_lp` semantics = the reconciliation formula), D22 (`shared/` codecs).
Evidence tags per `README.md` — ✅ verified / ⚠️ unverified.

## What it is (and honestly isn't)

The one thing in the system no validator can enforce: the vault datum *claims*
`farmed_lp` sits in the executor-keyed farm position, but the executor key can
do a normal co-signed withdraw to its own address — no vault spend, no validator
run, datum unchanged — and the claim is silently false. Every piece of the truth
is public chain state, though: the datum, the vault value, the farm position,
the executor address, the share mint history. This monitor reconciles claims
against reality, continuously, and alarms on divergence.

**Tier framing (D18 scorecard):** this is Tier 2 — *publicly detectable*, not
validator-prevented. It cannot stop the executor key from stealing farmed LP; it
converts "trust us indefinitely" into "any dishonesty is visible within minutes,
forever." Deterrence + a bounded deception window + capped capital bounding the
worst case. **N5 rule: never present this as making farm custody trustless.**

**The trust property is that anyone can run it:** open-source script, public
inputs (any Blockfrost key or node), stateless. Our hosted dashboard is a
convenience; the verifiability is the product.

## Components touched

| Component | Role |
|---|---|
| chain reads (Blockfrost or any node) | vault UTXO + datum (✅ calls exercised throughout research), farm position UTXO, executor address balance, share-asset mint history |
| `shared/` codecs (D22) | parse `VaultDatum`; same cast as validator/indexer — one implementation |
| monitor script (new, executor repo or standalone) | the checks below, on a timer; stateless per tick |
| public surface | feed (JSON) + dashboard; alert channel for threshold breaches |

Farm position location: UTxOs at Minswap's farm script filtered to owner ==
executor pkh + our LP asset (⚠️ exact datum filter shape from
`reference/farm-onchain/` decode — confirmed shape-wise, exercised at dust time).

## The checks (all public data; run every tick)

Let `D` = parsed vault datum, `V` = vault UTXO value, `E` = executor address,
`F` = farm position.

```
C1 locate      exactly one UTXO carries the thread NFT (N6); it parses via the
               shared codec. Zero or >1 ⇒ CRITICAL (should be impossible).
C2 internal    V.lp == D.total_lp − D.farmed_lp
               (true by value conservation if the validator is right —
               checking catches OUR bugs, not theft)
C3 custody     F.lp + E.pool_lp == D.farmed_lp          ← the headline check
               (farmed_lp = "LP outside the vault under executor farm-custody";
               E.pool_lp is the in-flight remainder during crossings)
C4 supply      minted − burned (full mint history of share asset) == D.total_shares
               (N6 makes counterfeit minting impossible; this confirms it held)
C5 rate        D.total_lp / D.total_shares is monotonically non-decreasing
               across observations (deposits/redeems rate-neutral, harvests
               raise, N3 dust raises — ANY decrease ⇒ CRITICAL). C5 is N3
               restated globally (same floor inequalities), and the live alarm
               behind the RecordHarvest fee-mint bound t ≤ floor(ΔLP·S/L)
               (compound-cycle.md note 1). Measures LP-per-share, NOT
               value-per-share — impermanent loss lives inside the LP token
               and never trips C5 (dashboard copy must say so; N5).
C6 pending     accrued-unharvested rewards (informational: trigger transparency,
               "next compound ≈" display) — ⚠️ readability is dust-cycle (d)
```

## Tolerances & alert levels

- **C3 is the only check with a legitimate nonzero tolerance:** during a
  crossing, up to `MAX_INFLIGHT_LP` sits at `E` for minutes. Alert policy is
  therefore two-dimensional — **magnitude × duration**:
  `|Δ| ≤ MAX_INFLIGHT_LP` for < `INFLIGHT_WINDOW` ⇒ OK (expected);
  small-but-persistent or any `|Δ| > MAX_INFLIGHT_LP` ⇒ ALARM.
  Exception state: an **emergency withdraw** legitimately parks the whole
  position at `E` — the monitor should still alarm (it IS an anomaly); the
  published incident notice is what explains it. No "suppress alarms" mode —
  a monitor that can be muted by its operator is worth less (N5).
- **C1, C2, C4, C5: zero tolerance.** Any breach ⇒ CRITICAL. These should be
  impossible while our validator + policies are correct — a breach means a bug
  or an exploit, both alarm-worthy.
- Rollback note: read at a small confirmation depth (or re-check on next tick)
  so chain reorgs don't fire false CRITICALs; a breach must persist two
  consecutive ticks before alarming.

## Cadence & publishing

- Tick: every ~1–2 minutes (chain reads are cheap; the deception window is the
  product — shorter is better, rate-limited by the data provider).
- Publish per tick: timestamp/slot, all check results, the raw numbers
  (D totals, V/E/F balances, circulating supply, rate), and rate history.
- Surface: public JSON feed + simple dashboard page; alerts (threshold
  breaches) to a public channel — open point 2.
- The monitor is also **our own** first alarm for executor bugs (C2/C3 catch a
  broken crossing faster than user reports would).

## Failure branches

- **Data provider down** → monitor reports STALE (last-good timestamp), not
  green. Stale ≠ OK; the dashboard must distinguish "verified at T" from
  "can't verify." Anyone can point the open-source script at another provider.
- **Chain reorg** → two-tick persistence rule above.
- **Monitor itself down** → the public feed goes stale, which is itself
  visible. (An uptime expectation is part of open point 1.)

## Open design points

1. **Where it runs** — inside the executor service (shares codecs/infra, but
   then executor-down = monitor-down — the two things you most want
   independent) vs. a standalone deployment (separate host + own Blockfrost
   key; more moving parts). Lean: standalone — the monitor watching the
   executor shouldn't share its fate. Decide at build time.
2. **Alert channel** — where breaches land publicly (Discord webhook? status
   page?). Trivial config, decide with the web.
3. **v1/demo scope** — full dashboard vs. JSON feed + minimal page for the
   pitch. The checks themselves are demo-day material (the custody-honesty
   story is a differentiator); scope the UI with the web work.
