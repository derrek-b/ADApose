# Workflows

Design-level walkthroughs of every action path the app implements — pseudo-code at
most, no source. Each doc lays out: the actors and components touched, the APIs hit
and the values they return, the on-chain checks (mapped to D20-N invariants by name),
the step-by-step processing logic, and every failure branch inline with its recovery.

These sit between `docs/decisions.md` (why) and the eventual source (how) — a
workflow doc is the implementation contract for its path. If writing one surfaces a
design gap, the doc flags it in **Open design points** and the resolution goes to
`decisions.md` as a D-entry; workflows never silently override decisions.

## Evidence conventions

Per the scope-claims-to-evidence rule, every API/contract claim carries a tag:

- ✅ **VERIFIED** — proven against a real chain, the vendored SDK source, or a live
  endpoint (citation given).
- ⚠️ **UNVERIFIED** — assumed shape; each one should trace to a `docs/week1-verify.md`
  item. If it doesn't, add the item.

## Index

| Doc | Path | Status |
|---|---|---|
| [value-flow.md](value-flow.md) | Study guide: UTXO & value movement per workflow, tx by tx | drafted |
| [deposit.md](deposit.md) | User deposit: order UTXO → ApplyOrders batch → share mint | drafted |
| [redeem.md](redeem.md) | User redemption: order UTXO → ApplyOrders → share burn + LP payout | drafted |
| [vault-init.md](vault-init.md) | Bootstrap: vault UTXO + thread NFT (N6) + dead shares (N2) + CIP-68 ref NFT + reference scripts | stub — duty list |
| [enter-exit-farm.md](enter-exit-farm.md) | Vault ↔ farm custody boundary, both directions (two-hop via executor address) | drafted |
| compound-cycle.md | Multi-tx: API harvest → MIN→pair swap → add-liquidity → stake → RecordHarvest | planned |
| [emergency-withdraw.md](emergency-withdraw.md) | Trustless farm exit (constructor 3, owner-only) + unwind to vault | drafted |
| [rescue.md](rescue.md) | Treasury-signed stray-UTXO recovery (D10) | drafted |
| proof-of-reserves.md | Public monitor: datum totals vs farm position (N5/D18 mitigation) | planned |
