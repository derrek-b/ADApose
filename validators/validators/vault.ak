//// Pomona vault validator — skeleton, pre-build.
//// One UTXO per user at this script address. Datum carries owner + position state.
//// See ../../docs/decisions.md D1/D2 for the invariants this must enforce.
////
//// NOTE: written before first `aiken check` — syntax/stdlib details to be
//// validated in Week 1. This file is a design artifact, not shipped code.

// Datum sketch (D2):
//   owner: VerificationKeyHash     -- immutable; only signer who can Withdraw
//   pool_id: ByteArray             -- immutable; the Minswap V2 pool this vault serves
//   max_slippage_bps: Int          -- immutable; bound on compound swaps
//   last_compound: Int             -- mutable (POSIXTime)
//   fee_owed_accounting: Int       -- mutable

// Redeemer sketch:
//   Deposit    -- anyone may add value to their own vault (owner-signed)
//   Withdraw   -- owner-signed; value flows only to owner
//   Compound   -- executor-signed; checks D2 compound invariants 1-5

// validator vault(executor: VerificationKeyHash, treasury: Address, fee_bps: Int) {
//   spend(datum: VaultDatum, redeemer: VaultAction, ctx: ScriptContext) {
//     when redeemer is {
//       Withdraw -> owner_signed(ctx, datum.owner)
//       Compound -> and {
//         executor_signed(ctx, executor),
//         continues_at_same_script(ctx),
//         value_grows_minus_fee(ctx, fee_bps, treasury),
//         datum_immutables_preserved(ctx, datum),
//         slippage_within(ctx, datum.max_slippage_bps),
//       }
//       Deposit -> owner_signed(ctx, datum.owner) && continues_at_same_script(ctx)
//     }
//   }
// }
