//// Pomona vault validator — skeleton, pre-build.
//// One UTXO per user at this script address. Datum carries owner + position state.
//// See ../../docs/decisions.md D1/D2 (invariants) and D10–D14 (topology, slippage,
//// fees, settlement, version ladder) for the design this must enforce.
////
//// NOTE: written before first `aiken check` — syntax/stdlib details to be
//// validated in Week 1. This file is a design artifact, not shipped code.

// Topology (D11): ONE validator per DEX; all of that DEX's pools share this
// script address. The pool is bound per-vault via the datum, so adding a pool
// is an off-chain config change, not a deployment. A new DEX = a new validator.

// Datum sketch (D2, slimmed per D12/D13):
//   owner: VerificationKeyHash   -- immutable; only signer who can Withdraw
//   pool_id: ByteArray           -- immutable; Minswap V2 pool binding = the LP
//                                   asset name. Security invariant: pins Compound
//                                   to the owner-chosen pool (slippage checks are
//                                   meaningless against an attacker-chosen pool)
//   last_compound: Int           -- mutable (POSIXTime)
//   fee_owed: Int                -- mutable; treasury's accrued cut, denominated
//                                   in LP tokens (D13). Accrues on Compound,
//                                   settles in full on Withdraw (D14)
//
// Slippage is deliberately NOT here (D12): the on-chain floor is a validator
// parameter (uniform anti-theft bound, checked against pool spot price via
// reference input); the adaptive per-order tolerance lives in executor code.
// Field names cost nothing on-chain (positional CBOR; names erased in UPLC) —
// name for the auditor. But trace strings DO embed — strip traces for mainnet.

// Redeemer sketch (v1 — full withdraw only; v2 adds Collect + maybe partial, D14):
//   Deposit    -- owner-signed top-up of their own vault
//   Withdraw   -- owner-signed, FULL only: vault UTXO consumed, no continuing
//                 output; fee_owed LP → treasury (waived if < dust_threshold);
//                 everything else → owner
//   Compound   -- executor-signed; accrue-only (no settlement branch):
//                 fee_owed += fee_bps × ΔLP, position only grows
//   Rescue     -- treasury-signed; ONLY for stray UTxOs (D10): datum missing or
//                 not a VaultDatum. A valid datum must never reach this branch.

// Plutus V3: spend datum arrives as Option<Data> — receipt of outputs can't be
// rejected (no receive/fallback equivalent), so unparseable/datum-less UTxOs are
// recovered via Rescue instead of being stuck forever (D10).

// Parameters bake into the script hash: changing ANY of them = new address =
// user migration (D11). Keep them stable; pools deliberately excluded.
// validator vault(
//   executor: VerificationKeyHash,
//   treasury: Address,
//   fee_bps: Int,              -- 450 = 4.5% of ΔLP per compound (D13)
//   slippage_floor_bps: Int,   -- loose anti-theft bound, NOT execution tuning (D12)
//   dust_threshold: Int,       -- LP amount below which Withdraw settlement is waived (D14)
// ) {
//   spend(raw_datum: Option<Data>, redeemer: VaultAction, oref, tx) {
//     when soft_cast_vault_datum(raw_datum) is {
//       Some(datum) -> when redeemer is {
//         Withdraw -> and {
//           owner_signed(tx, datum.owner),
//           no_continuing_output(tx),                    -- v1: full withdraw only (D14)
//           fee_settled_or_waived(tx, datum.fee_owed, treasury, dust_threshold),
//         }
//         Compound -> and {
//           executor_signed(tx, executor),
//           continues_at_same_script(tx),
//           position_only_grows(tx, datum.pool_id),      -- ΔLP ≥ 0, principal untouchable
//           fee_accrual_exact(tx, datum, fee_bps),       -- fee_owed += fee_bps × ΔLP, no settle branch (D13/D14)
//           datum_immutables_preserved(tx, datum),       -- owner + pool_id frozen
//           orders_target_pool(tx, datum.pool_id),       -- pool binding (D11)
//           swap_above_floor(tx, slippage_floor_bps),    -- vs spot from pool reference input (D12)
//         }
//         Deposit -> owner_signed(tx, datum.owner) && continues_at_same_script(tx)
//         Rescue -> False  -- valid vaults are NEVER rescuable
//       }
//       None -> when redeemer is {
//         Rescue -> treasury_signed(tx, treasury)  -- stray UTxO: no/bad datum
//         _ -> False
//       }
//     }
//   }
// }
