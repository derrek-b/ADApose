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
- `deposit.md`'s asset leg needs `POMONA_ORDER_VALIDATOR_ADDR` at web-build time —
  the order validator address must be final (datum shape frozen, D21 addendum)
  before any deposit UI exists.

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
