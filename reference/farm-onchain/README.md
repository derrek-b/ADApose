# Minswap Yield Farming v2 — on-chain script (vendored from mainnet)

Source is unpublished (see decisions.md D6); this is the DEPLOYED script fetched by
hash and decompiled, 2026-07-16.

| File | What |
|---|---|
| `script_b15a1a01.cbor.hex` | Raw script CBOR from chain (Koios `script_info`), hash `b15a1a010843e8afb6f963b03d452be815b533dad0cd23d819c2d201`, Plutus V2, 2,890 bytes |
| `farm_v2.uplc` | `aiken uplc decode` of the flat encoding (unwrap outer CBOR first) |
| `farm_v2_pseudo.txt` | Beta-reduced pseudocode: 59 top-level bindings + MAIN, rendered for human reading |

Key findings (full analysis in decisions.md D6 addendum, 2026-07-16):
- Owner auth is `txSignedBy(owner_pkh)`; ScriptCredential owners fail — script-owned
  positions are creatable but unspendable.
- User-action branches also require hardcoded signatory
  `7fe3920105a0aebaaecc1b935cd5ebbd3cc8c28336449d27378825e1` (Minswap backend co-sign);
  confirmed in live spend txs' required_signers.
- Redeemer: 4 variants; observed live: `Constr 1 []` (single op), `Constr 2 [i]`
  (batched, input index). Position datum:
  `Constr 0 [owner_address, staked_asset_class, Int, [(asset, Int)]]`, datum by hash.

Helper map for reading the pseudocode: i_0=Y-combinator · i_1/i_2=fst/snd ·
i_3..i_6=constructor-tag==3/2/1/0 · i_47=addressEquals (both credential types) ·
i_49=datum lookup by hash in txInfoData · i_51=same-owner-and-asset datum compare ·
i_57=valueOf(value, policy, name) · i_66=txInfo fields · i_67=signatories ·
i_68=signed-by-hardcoded-admin · i_69=signed-by-datum-owner (pubkey only, script→fail).
