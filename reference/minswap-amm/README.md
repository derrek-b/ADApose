# Minswap V2 AMM order/pool contracts (vendored 2026-07-17)

Evidence behind D17 (LP-router fallback). Source: `github.com/minswap/minswap-dex-v2`
(open source). These are the AMM order/pool validators — DISTINCT from the closed-source
FARM staking contract (D6) whose admin co-sign blocks farm harvesting.

| File | Key finding |
|---|---|
| `order_validator.ak` | `ApplyOrder` only requires the pool-batching withdrawal validator present (delegation) — no signature here. `CancelOrderByOwner` = `authorize_order_license` with 4 methods incl. **SpendScript** ⇒ script owners can cancel/reclaim. `CancelExpiredOrderByAnyone` = permissionless via a withdrawal cred. |
| `pool_validator.ak` | `validate_pool_batching` requires the tx be run by an authorized batcher from on-chain `GlobalSetting.batchers` (`authorize_pool_license`, line ~184-192) — a **licensed-batcher liveness dependency** (like Sundae scoopers), NOT a hardcoded per-user signature, and it CANNOT redirect funds (order enforces receiver). Admin ops (UpdatePoolParameters, WithdrawFeeSharing) are separately license-gated — expected. |
| `order_validation.ak` | (added 2026-07-18, evidence behind D21.) `validate_order_receiver` (line 1196): fill output MUST land at `success_receiver`; **`ScriptCredential` receivers explicitly supported**, and then `is_valid_datum` (line 1185) forces the fill output's datum to match the order's `ExtraOrderDatum` — `EODInlineDatum(h)` ⇒ output carries an inline datum with `blake2b_256(serialise(d)) == h`. Third-party script delivery with a mandated datum is validator-enforced, not batcher courtesy. |

**Conclusion:** adding/removing liquidity on Minswap's AMM is non-custodial and
un-gated in the custody/authorization sense — same shape as WingRiders (D16). The only
dependency is Minswap's licensed batchers (liveness/censorship, not theft; orders are
owner-cancellable incl. by a script). This is categorically different from the Minswap
FARM admin co-sign (D6).
