<!-- Source: legacy/validators/validators/vault.ak -->
# Workflow: Rescue (stray-UTXO recovery — D10)

**Path:** unparseable UTXO at either of our script addresses → treasury-signed
`Rescue` spend → value to treasury.
**Decisions:** D10 (the model), D21 addendum (order validator gets the same path),
D20-N (N1/N6 are why strays are harmless), D21 addendum (inline-datums-only
emission policy).
Not a user-facing path — an admin backstop for value that gets stuck at our
addresses in UTxOs that **cannot be real protocol state**. No Minswap, no API,
no external dependency anywhere in this doc.

## The security boundary (the one rule)

`Rescue` is spendable **iff the UTXO's datum is missing OR fails to cast** to the
address's datum type (`VaultDatum` / `OrderDatum`) — plus a treasury signature.
Nothing else about the spend is constrained (D10: the cast check IS the boundary).
The contrapositive is the load-bearing guarantee: **anything that casts is never
rescuable** — no real vault, no real order, no user funds are reachable by
treasury, ever. Rescue cannot be config-widened into an admin drain; widening it
means changing the validator, i.e. a new address.

Two addresses carry the path (each ONE script for all pools):

| Address | Real state looks like | Rescue reaches |
|---|---|---|
| vault validator | THE vault UTXO: castable datum + thread NFT (N6) | everything else with missing/uncastable datum |
| order validator | order UTxOs: castable inline `OrderDatum` | same |

## How strays happen (and which ones Rescue can't help)

1. **Bare sends** — a wallet user sends tokens straight to a script address they
   saw on-chain, no datum attached. Classic loss case on Cardano; Rescue
   recovers it. (N1 means such donations never touched our accounting anyway.)
2. **Datum-by-hash with a lost preimage** — the UTXO is **unspendable by the
   protocol itself**: no witness can satisfy "provide the preimage," so not even
   Rescue reaches it (the ledger, not our validator, is the wall). This is why
   the emission policy exists: **every UTXO our web/executor builds carries an
   inline datum, no exceptions** (D21 addendum). Our own artifacts are never in
   this class.
3. **Uncastable inline datum** — hand-crafted or third-party-integration sends
   with a wrong-shaped datum. Rescuable.
4. **Castable but garbage** — hand-crafted UTxOs whose datum casts fine but whose
   fields are junk. NOT rescuable (it casts), and by design:
   - a castable *order* with a wrong `pool_nft` or unsatisfiable `min_out` is
     recoverable by its own `canceller` — Cancel is the owner's path, Rescue is
     irrelevant. If the canceller field itself points at a key nobody holds,
     the UTXO is stuck forever — accepted: we never build such orders (web sets
     canceller = the connected wallet), so it's a hand-crafter's own loss.
   - a castable *counterfeit vault* (doctored datum, no thread NFT — the N6
     attack shape) can neither mint (N6 kills it) nor be rescued (it casts) nor
     be spent through normal paths (every vault redeemer requires MY thread
     NFT). Permanently stuck, harmless, attacker's loss. Accepted.

## Steps

1. **Detect** (executor indexer, same polling loop as order discovery): any UTXO
   at either script address whose `inline_datum` is null or fails the codec's
   cast (`shared/` codecs — the SAME cast the validator performs, one
   implementation) is flagged `rescuable`; datum-hash UTxOs flagged
   `unrecoverable` (report-only). No urgency — strays can't interact with
   anything (N1/N6); this is a housekeeping queue, lowest priority in the
   system.
2. **Build** (batched, occasional): one tx spending flagged UTxOs with `Rescue`,
   all value → treasury address. Not a vault spend — no interaction with the
   precedence queue; the vault UTXO is not an input (it casts; it can't be).
3. **Verify + sign:** D19 verifier discipline applies (it's a tx we sign) —
   intent: inputs are exactly the flagged strays, output to treasury only.
   Treasury key signs — note this is a treasury action, not an executor
   hot-key action (key separation; ties into vault-init's key-encoding
   question).
4. **Record:** rescued value logged publicly (amount, source tx, date) — N5's
   transparency posture; treasury holds it for the return policy below.

**Failure branches:** rollback re-derives the flag set (stateless-resume, as
everywhere); a race where a "stray's" owner somehow spends first (impossible for
datumless UTxOs — no spending path but Rescue — but harmless if it happened:
our input just vanishes, tx fails, rebuild).

## Return policy (off-chain, discretionary)

D10 sends value to treasury, not back to the sender — on-chain "return to
sender" is unknowable (a UTXO carries no sender identity; signatures live in a
tx's witness set, not in outputs). Policy: hold rescued value at treasury;
**best-effort manual return on verified claim**, two-part proof:

1. **Chain fact (no claimant needed):** the stray records its funding tx; that
   tx's inputs + witness set identify the payment key `K` that authorized the
   funding (and usually a change output back to the same wallet).
2. **Fresh possession proof:** claimant signs an unrepeatable challenge message
   (`"claiming stray <tx_hash>, <date>, <nonce>"`) via CIP-8 message signing
   (CIP-30 `signData` — every wallet has it; off-chain, no tx). Signature
   verifies against `K` ⇒ the claimant holds the key that funded the stray.

Known holes (why this is best-effort, not a rule): **exchange withdrawals** —
the funding tx's keys belong to the exchange's hot wallet, not the user; the
rightful owner cannot produce the proof. **Script-address senders** can't sign
messages at all — case by case.

**Handling fee (2026-07-23):** flat fee + actual network costs, deducted from
the returned value, published in advance (amount = build-time config, with the
sweep cadence/minimum). Flat, not percentage — the work is constant regardless
of value (treasury-key signing, verification, a tx). Corollary: strays worth
less than the fee are economically unreturnable — same floor as the sweep
minimum. A verified claim is processed when verified, independent of the sweep
cadence (the fee is what pays for jumping the housekeeping queue — no separate
expedite tier).

Never automatic, never on-chain-promised — a posted fee on a discretionary
goodwill service is honest; promising a guarantee the validator doesn't enforce
would be an N5 violation.

## Open design points

1. **Treasury key definition** — who/what is "treasury-signed" (single key,
   multisig, threshold?) — same decision cluster as vault-init.md's
   key-encoding question; Rescue just consumes it.
2. **Cadence + minimum + return fee amount** — rescue batches are pure cost
   (fees) for value that isn't ours; sweep only when flagged value exceeds some
   floor, or on a slow timer (monthly?). One consistent floor with the return
   fee (above). Trivial config, decide at build time.
