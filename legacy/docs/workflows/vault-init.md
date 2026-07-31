<!-- Source: legacy/validators/validators/vault.ak -->
# Workflow: Vault Init (STUB — duty list only)

**Status: not yet designed.** This stub exists to collect every one-time init duty and
tie-in discovered while writing the other workflow docs, so nothing is lost between
sessions. Full step-by-step TBD.

**Decisions feeding this doc:** D20 (pooled design), D20-N (esp. N2, N6), D20 addenda
(CIP-68 metadata), D21 addenda (order validator exists alongside vault).

## Duty list (everything the init path must do, accumulated so far)

1. **Create the pooled vault UTXO** at the vault validator address with the init
   datum `{pool_id, total_shares: <dead-shares offset>, total_lp, farmed_lp: 0,
   share_asset}` — exact init values are an open question below (N2 scheme).
2. **Mint the thread NFT (N6)** — one-of-one, into the vault UTXO. Uniqueness needs a
   **one-shot policy** (standard pattern: parameterize the policy by a specific UTXO
   ref that the init tx consumes — the policy can then provably never mint again).
3. **Mint dead shares (N2)** — fixed virtual share offset to an unspendable output
   (kills first-depositor inflation).
4. **Mint the CIP-68 `(100)` reference NFT** with inline metadata datum
   `{name, ticker, decimals, logo}`, parked at a treasury-controlled output — the
   share token itself uses the CIP-67 `(333)` label, frozen at first mint (D20
   addendum 2026-07-18).
5. **Publish reference scripts** — vault validator, order validator, share mint
   policy — so later txs (`ApplyOrders`, user Cancels) reference instead of attach
   (no deploy step exists; validator hash = address — CLAUDE.md).

## Tie-ins from other docs (why init shapes them)

- `deposit.md` Step A locates the vault **by thread NFT** (N6) — init is where that
  NFT comes into existence.
- The share mint policy authorizes on the NFT's presence (vault.ak sketch) — so the
  NFT policy id is a **parameter of the share mint policy** → init artifacts are
  interdependent; their hashes must be computed in the right order.
- `deposit.md`'s asset leg needs `ADAPOSE_ORDER_VALIDATOR_ADDR` at web-build time —
  the order validator address must be final (datum shape frozen, D21 addendum)
  before any deposit UI exists.
- **NOT an init duty:** the first farm stake — resolved lazy (enter-exit-farm.md
  Open point 3, 2026-07-23); the executor queries position existence before every
  enter, so init does nothing farm-side. Don't re-add it.

## Open questions (design when this doc is written properly)

- **N2 exact scheme:** virtual shares only, or paired virtual shares + virtual
  assets offset (full ERC-4626-style)? Sets the init datum's `total_shares`/`total_lp`
  values and the `n2_` test's expected math.
- **Who may init?** Treasury-signed one-shot presumably — but is permissionless init
  of NEW pools ever wanted (Phase 2+), and does anything break if someone inits a
  junk pool?
- **One policy or several?** Thread NFT, dead shares, `(100)` reference NFT, `(333)`
  share token — one parameterized policy with distinct asset names vs. separate
  policies. Affects hash-ordering above.
- **One tx or several?** Five duties + reference-script publishing may exceed tx
  limits; if split, define the safe intermediate states.
- **Share asset name:** exact bytes — `(333)` label + what pool identifier?
- **Key encoding & rotation (added 2026-07-19):** four vault redeemers are
  executor-signed and two paths treasury-signed — where do those key hashes live?
  Covers BOTH keys, and for treasury also its **form** (added 2026-07-23): single
  key vs native-script multisig vs threshold — "treasury-signed" compiles to a
  different check under each, and treasury is the cold high-privilege identity
  (fee shares, Rescue, emergency authorization, CIP-68 ref NFT — rescue.md Open
  point 1 consumes this decision). Executor = hot service key; never the same
  key, that separation is what makes D18's blast-radius pricing real.
  Decide **together with the `EnterFarm` destination pin** (enter-exit-farm.md
  Open point 1, added 2026-07-23): pinning `destination == EXECUTOR_ADDR` in
  EnterFarm converts executor misroute bugs into rejected txs (worthless against
  a stolen key — that's D18's job) but names the executor address in the
  validator, the same parameter-vs-datum coupling as the keys themselves —
  one decision, not two. **Leaning: pin it** (one-line check; the coupling
  exists anyway via the executor-signed `auth` checks).
  (a) **Validator parameters** — baked into the script hash; simplest, but rotation
  = new address = full migration, and there is deliberately no migrate redeemer
  (upgrade path = users redeem + re-deposit). (b) **Datum fields** — rotatable via
  a treasury-signed rotate path; adds surface + a new redeemer. The executor key is
  hot and D18's threat model centers on its compromise, so "what happens after a
  key compromise" needs a real answer — and the choice shapes the init datum AND
  the hash-ordering item above (parameters feed the script hash).
- **Pool-registry recording (added 2026-07-26, surfaced designing `deposit.md`'s
  `readVaultState`):** the thread-NFT policy id + resulting parameterized
  share-mint policy hash are generated *by running init*, not derivable from
  `plutus.json` the way validator addresses are (D22 rule 3) — a one-shot
  policy's id depends on which UTXO the init tx actually consumed, so it can't
  be known before init runs and is only ever known that one time. Off-chain
  readers can never trust a thread-NFT id read from a UTXO's own datum
  (circular — a counterfeit vault has its own datum too), so it has to come
  from a durable, independently-trusted record instead. Proposed shape (not
  decided): (1) the init procedure **programmatically writes** the resulting
  `{poolKey, poolId, threadNftUnit, shareAssetUnit, initTxHash}` entry the
  moment the init tx confirms — never hand-transcribed; (2) recorded in TWO
  places, matching this project's existing narrative-vs-machine split — a
  dated `decisions.md` entry (citing the init tx hash, same pattern as D24)
  for the human record, and a `shared/` config entry (D22) for the code both
  web and executor import; (3) git-tracked, not a database — small, rare to
  change, benefits from the same audit trail as everything else here; (4)
  keyed by network — preprod and mainnet inits of "the same" pool produce
  different thread-NFT policies. Exact file format/location TBD when this doc
  is written properly; doesn't block `readVaultState`'s interface (its shape
  only assumes *some* `poolKey → {threadNftUnit, vaultAddress}` resolution
  exists, never depends on how it's stored).
- ~~**Datum forward-compatibility (CIP-68-style extensibility field)**~~
  **RESOLVED 2026-07-26, surfaced designing `deposit.md`'s `listMyLegs`/
  `cancelOrder`:** `OrderDatum` (and, by the same argument, `VaultDatum`) gets
  a generic `extra: Data` catch-all field from day one — empty/unused for v1,
  reserved so a later addition never needs a new validator. Researched, not
  assumed: Aiken's own docs don't explicitly state whether `expect x: T = data`
  tolerates a wire value with more fields than `T` declares, and Minswap's
  production validator (`reference/minswap-amm/pool_validator.ak:313-321`)
  only demonstrates the `..` spread pattern for *ignoring known fields while
  reading an already-compiled type* — a different question. What actually
  decided this: CIP-68 itself is the ecosystem's answer to exactly this
  problem (`[metadata, version, extra]` — an extensibility mechanism wouldn't
  need to exist as its own CIP if naive field-appending were free), and both
  Minswap and WingRiders independently chose full versioned-type replacement
  (V1→V2, confirmed in each of their vendored/researched sources) over
  retrofitting when their own datums evolved. Given "no deploy step, validator
  hash = address," that pattern means a new validator + full user migration
  (D11: "migration = withdraw + redeposit") if we don't reserve the slot now —
  cost of an unused `Data` field today is near-zero (marginal minUTxO/fee
  bump, zero validator complexity, never parsed); cost of adding it after
  launch is a migration, most likely discovered only once real funds are
  already live. **`batch_id`** (grouping the order UTxOs one deposit action
  produced, so a returning user's "cancel everything" can find what
  "everything" means beyond the current session) is one deferred candidate
  use for this field — NOT decided now; only the generic slot is.
