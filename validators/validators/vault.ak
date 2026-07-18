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
//// └─────────────────────────────────────────────────────────────────────────┘

// Vault datum sketch (one UTXO per pool):
//   pool_id: ByteArray          -- immutable; Minswap V2 LP asset name (D11 carries over)
//   total_shares: Int           -- N1: the only denominator that exists
//   farmed_lp: Int              -- N1: LP units entered into the farm (datum-tracked,
//                                  updated only on validator-checked transitions)
//   share_asset: AssetName      -- the pool's share token name (mint policy paired)

// Order datum sketch (separate order validator, N4):
//   owner: VerificationKeyHash  -- only signer who can Cancel
//   action: Deposit(assets) | Redeem(shares)
//   min_out: Int                -- user's slippage/limit protection
//   deadline: POSIXTime

// Vault redeemer sketch:
//   ApplyOrders   -- executor-signed batch: apply deposit/redeem orders against the
//                    vault. Checks: share mint == Σ deposits at datum exchange rate
//                    (N3: round shares DOWN); redemption payouts at datum rate
//                    (N3: round assets DOWN); totals updated exactly (N1);
//                    every order satisfied or untouched (no cherry-pick griefing)
//   EnterFarm     -- executor-signed: vault LP → Minswap farm via D19 API tx;
//                    farmed_lp += exact LP leaving (N1); value may ONLY move to the
//                    farm path (order/position outputs verified, D12 floor on swaps)
//   RecordHarvest -- executor-signed, post-compound: farmed_lp += harvested ΔLP;
//                    treasury share mint == fee_bps × ΔLP-equivalent shares (D20 fee;
//                    LP-units discipline — fee on emissions, never in-pool growth)
//   Rescue        -- treasury-signed; ONLY missing/unparseable datums (D10, unchanged)

// Share mint policy sketch:
//   mint/burn allowed ONLY when the pooled vault UTXO for this pool is spent in the
//   same tx with ApplyOrders/RecordHarvest (delegation by presence); amounts checked
//   by the vault validator. N2: init path mints DEAD_SHARES to an unspendable output.

// Off-chain (executor) invariants that pair with this file — D19:
//   never blind-sign: every tx (API-built or SDK/Lucid-built) re-parsed from raw CBOR
//   by the independent verifier against pre-stated intent before the hot key signs.
