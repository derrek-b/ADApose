//// Pomona pooled vault — skeleton, pre-build. SUPERSEDES the per-user sketch (D20).
//// One pooled vault UTXO per pool; users hold fungible share tokens; farm layer is
//// an executor-keyed aggregate Minswap position (D16/D19 — unchanged by D20).
//// Design record: docs/decisions.md D20 (+ D10/D12/D19 which survive).
////
//// ┌─────────────────────────────────────────────────────────────────────────┐
//// │ D20-N · NON-NEGOTIABLE INVARIANTS — do not implement around these.      │
//// │ Each must exist as a named check below AND a test (`aiken check -m nX_`)│
//// │                                                                         │
//// │ N1 DATUM-TRUTH   exchange rate ONLY from datum totals, never balances   │
//// │ N2 DEAD SHARES   fixed virtual share offset at init (inflation attack)  │
//// │ N3 ROUNDING      shares round DOWN on mint, assets DOWN on redeem —     │
//// │                  every remainder stays in the pool, no exceptions       │
//// │ N4 ORDERS ONLY   users never spend the vault; deposit/redeem = order    │
//// │                  UTxOs, batched by executor, owner-cancellable anytime  │
//// │ N5 CUSTODY HONESTY (comms) — shares are a redemption claim against an   │
//// │                  executor-keyed farm; never describe as more sovereign  │
//// │ N6 THREAD NFT    one-of-one auth NFT = THE vault UTXO; validator and    │
//// │                  mint policy key on the NFT, never on the address       │
//// └─────────────────────────────────────────────────────────────────────────┘

// Vault datum sketch (one UTXO per pool):
//   pool_id: ByteArray          -- immutable; Minswap V2 LP asset name (D11 carries over)
//   total_shares: Int           -- N1: the only share denominator that exists
//   total_lp: Int               -- N1: ALL pool-owned LP (vault-held + farmed) — the
//                                  exchange-rate numerator. Added by D20 addendum
//                                  2026-07-18: pricing by farmed_lp alone understates
//                                  the rate while deposits sit unfarmed between
//                                  ApplyOrders and EnterFarm, over-minting shares.
//   farmed_lp: Int              -- custody sub-ledger: the slice of total_lp inside the
//                                  executor-keyed farm (never used for pricing;
//                                  invariant: farmed_lp <= total_lp)
//   share_asset: AssetName      -- the pool's share token name (mint policy paired)

// Order datum sketch (separate order validator, N4 — ONE script for ALL pools,
// like the vault; pool identity lives in the datum, D21 addendum):
//   pool_nft: AssetId           -- the pool's thread NFT (N6) — strongest possible
//                                  pool identifier (one-of-one by construction);
//                                  scopes this order to exactly one vault
//   canceller: AuthMethod       -- who may Cancel: Signature(pkh) | SpendScript(hash)
//                                  (Minswap's proven split, D21 addendum — an Address
//                                  can't sign; script wallets need spend-script auth
//                                  or their orders are bricked, an N4 violation)
//   payout: Address             -- full address (payment + stake cred) — shares/refunds
//                                  land with the user's stake rights intact
//   action: Deposit | Redeem(shares)
//                                  -- Deposit carries NO amount: lp is value-derived
//                                  (gap-2 rule, deposit.md Step D); Redeem TBD in
//                                  redeem.md
//   min_out: Int                -- user's slippage/limit protection
//   deadline: POSIXTime
//
// Order validator spending paths:
//   Cancel  -- canceller authorized (Signature | SpendScript), no other condition,
//              anytime — the user's only recovery path, never executor-dependent (N4)
//   Apply   -- only if an input carrying this order's pool_nft (the thread NFT) is
//              spent in the same tx (delegation-by-presence, N6-anchored; vault does
//              the accounting checks)
//   Rescue  -- treasury-signed, ONLY when datum is missing/fails to cast to OrderDatum
//              (D10 model via D21 addendum — backstop for bricked sends; datums that
//              cast are NEVER rescuable; emission policy: inline datums only)

// Vault redeemer sketch:
//   ApplyOrders   -- executor-signed batch: apply deposit/redeem orders against the
//                    vault (mixed batches allowed). Every order prices at the UNIFORM
//                    pre-batch rate = input datum total_lp/total_shares; continuing
//                    datum updates as net sums (D20 addendum 2026-07-19 — safe by
//                    rate-neutrality + double-floor round trip). Checks: share mint
//                    == Σ deposits at that rate (N3: round shares DOWN); redemption
//                    payouts at that rate (N3: round assets DOWN); total_lp &
//                    total_shares updated exactly (N1); every order satisfied or untouched
//                    (no cherry-pick griefing); every spent order's pool_nft == MY
//                    thread NFT (cross-pool orders can't leak into this batch);
//                    lp_i = pool-LP amount in the order's VALUE (never datum-claimed);
//                    payout_i gets order_value − lp_i + shares_i (pass-through:
//                    extras return to user — never vault-absorbed, never executor)
//   EnterFarm     -- executor-signed: vault LP → Minswap farm via D19 API tx;
//                    farmed_lp += exact LP leaving, total_lp unchanged (N1); value may
//                    ONLY move to the farm path (order/position outputs verified,
//                    D12 floor on swaps)
//   ExitFarm      -- executor-signed mirror of EnterFarm (D20 addendum 2026-07-19 —
//                    surfaced by redeem.md: without it farm-withdrawn LP had no path
//                    back into the vault; buffer-miss redemptions unservable): vault
//                    value += LP entering; farmed_lp -= exactly that amount;
//                    total_lp/total_shares/rate unchanged (custody move, never a
//                    rate event — N1). Named check `solvency`: 0 <= farmed_lp <=
//                    total_lp survives every transition. Also the on-chain leg of
//                    the emergency-withdraw unwind (D19).
//   RecordHarvest -- executor-signed, post-compound: total_lp and farmed_lp += ΔLP;
//                    treasury share mint == fee_bps × ΔLP-equivalent shares (D20 fee;
//                    LP-units discipline — fee on emissions, never in-pool growth);
//                    fee-mint bound (named check): t <= floor(ΔLP × total_shares /
//                    total_lp) — the rate-non-decrease line; PoR check C5 is the
//                    live alarm behind it (compound-cycle.md note 1)
//   Rescue        -- treasury-signed; ONLY missing/unparseable datums (D10, unchanged)
//
// Deliberately ABSENT (confirmed 2026-07-19 — absence is chosen, not missed):
//   no wind-down/retire path (vault UTXO + thread NFT persist forever at ~minUTxO
//   cost); no migrate/upgrade redeemer (a treasury-signed migrate is a backdoor by
//   definition — upgrades = users redeem and re-deposit into the new vault).

// Share mint policy sketch:
//   mint/burn allowed ONLY when the vault UTXO carrying this pool's THREAD NFT (N6 —
//   never merely "a UTXO at the vault address") is spent in the same tx with
//   ApplyOrders/RecordHarvest; amounts checked by the vault validator, which also
//   requires the NFT in the continuing output. N2: init path mints DEAD_SHARES to an
//   unspendable output.
//   CIP-68 metadata from day one (decided 2026-07-18): share token asset name carries
//   the CIP-67 (333) fungible label; init also mints the paired (100) reference NFT
//   whose inline datum holds {name, ticker, decimals, logo}, parked at a
//   treasury-controlled output. Label is part of the asset name = frozen at first
//   mint; retrofitting would mean a new token + migration. (CIP-26 registry PR =
//   optional mainnet polish later.)

// Off-chain (executor) invariants that pair with this file — D19:
//   never blind-sign: every tx (API-built or SDK/Lucid-built) re-parsed from raw CBOR
//   by the independent verifier against pre-stated intent before the hot key signs.
