# WingRiders V2 — on-chain findings (vendored 2026-07-17)

Evidence behind decision D16. WingRiders contracts are open source
(`github.com/WingRiders/dex-v2-contracts`, Plutarch/Haskell), so most of this is read
from source, not decompiled. The farm-lock contract is only deployed (V1), so it was
decoded from chain like the Minswap farm.

| File | What |
|---|---|
| `Request.hs` | Order validator. `Apply` (agent) checks only that a pool-hash input is present; `Reclaim` = owner pubkey signature. No agent signature at request level. |
| `Types_Request.hs` | RequestDatum + RequestAction. Key: `beneficiary` **can be a script address**; actions include AddLiquidity / WithdrawLiquidity / AddStakingRewards. |
| `Staking_RewardMint.hs` | Reward-token minting policy; gated by WingRiders' staking-agent token. Emission step, not user harvest. |
| `shareslock.cbor.hex` | Deployed "Shares Lock" farm-lock script CBOR (Plutus V1, hash `0237cc313756ebb5bcfc2728f7bdc6a8047b471220a305aa373b278a`), fetched from mainnet by hash. |
| `shareslock.uplc` | `aiken uplc decode` of the above (unwrap outer CBOR first). |

## Deployed V2 script hashes (from minswap/cardano-contracts-registry → wingriders.json)
- V2 Constant Product Pool: `af97793b8702f381976cec83e303e9ce17781458c73c4bb16fe02b83`
- V2 Constant Product Request: `c134d839a64a5dfb9b155869ef3f34280751a622f69958baa8ffd29c`
- Shares Lock (farm lock, V1, ACTIVE 2026): `0237cc313756ebb5bcfc2728f7bdc6a8047b471220a305aa373b278a`

## Shares Lock trace (see D16 for full analysis)
- Hardcodes WingRiders authority AssetClass `1c0d57fdad384c5192735d38e467629316ad06650dcd038d54aa15ed` + tokenName `41` ("A") — 100k supply, ~all held by one WingRiders address (`addr1qxfnqq…`, the reward-distribution agent).
- Redeemer dispatch on constructor tag: tags 20–23 + default = **owner paths** (use datum, reach `equalsByteString` pubkey compare, no authority token) ⇒ locked LP is owner-recoverable (non-custodial). tag 24 = **agent path** (requires authority token "A", ignores datum owner) ⇒ reward distribution is WingRiders-agent-only.

## Pool evolve (Pool.hs, read at source — not vendored, large)
- `pvalidatePoolEvolve` requires an input holding the WingRiders **agent token** (`agentToken`, checked `== 1`). This is a token-presence gate (liveness), NOT a hardcoded signature; the pool enforces beneficiary + value conservation so the agent can't steal.
- `papplyAddStakingRewards` (Pool/ConstantProduct.hs) adds reward value directly into pool reserve A (`qtyA += rewardsQuantity`) — native auto-compound of the ADA-staking stream only.

## Open (blocked on a mainnet query source; Koios throttled)
1. Where does tag-24 send distributed WRT — can it target a script (our vault)?
2. Is Shares Lock still the live V2 farm mechanism (active on-chain, but docs restructured)?
