# Cardano DEX pivot survey (2026-07-17)

Evidence behind decision D15. Triggered by Minswap's farm co-sign gate (D6). Gating
criterion: can an executor build+submit a farm-reward harvest/compound tx WITHOUT the
DEX operator's signature?

Method: parallel web research (docs, GitHub, DefiLlama) + on-chain decode. WingRiders
was drilled down further — see `reference/wingriders-onchain/` and D16.

| DEX | Live? | AMM | Farm reward mechanism | Permissionless harvest? | Verdict |
|---|---|---|---|---|---|
| **WingRiders** | mainnet + preprod | constant-product | claimable WRT + partner; agent-distributed; lock non-custodial | post-receipt, not pull | **VIABLE (D16)** |
| Splash | ✗ ("coming soon") | hybrid TLB + CP | ve(3,3) SPLASH gauges (right model) | yes, but not live | watch |
| SundaeSwap | mainnet | constant-product | off-chain team-computed SUNDAE; scooper-gated settlement | ✗ nothing on-chain | dead |
| Minswap | mainnet | constant-product | on-chain, admin co-sign per spend (D6) | ✗ hard gate | dead w/o co-sign API |
| Danogo | mainnet | bond marketplace | no LP farm | n/a | dead (wrong product) |

**Meta-finding:** permissionless on-chain farm harvesting is rare on Cardano — the
batcher/agent model pushes compounding into the DEX's own agent, so rewards are either
gated or already auto-compounded. Explains why no live multi-DEX yield auto-compounder
exists (D9). The workable pattern found (WingRiders) is *post-receipt compounding*, not
permissionless harvest.

Key source URLs:
- WingRiders contracts: github.com/WingRiders/dex-v2-contracts
- Contract registry (deployed hashes): github.com/minswap/cardano-contracts-registry
- SundaeSwap off-chain emissions: forum.sundaeswap.finance/t/yield-farming-v2-proposal/3047
- Splash gauges/tokenomics: docs.splash.trade
