import { decodeFirstSync } from "cbor";

// Platform-agnostic, not Minswap-specific -- the transaction fee lives in
// transaction_body (a CBOR map, key 2), a structure the Cardano ledger's
// own CDDL defines, not something any individual DEX or wallet controls.
// Stable across eras (Shelley through Conway); applies identically to any
// valid Cardano transaction regardless of who built it.
//
// A strict, Cardano-aware parser (@minswap/cardano-serialization-lib-nodejs,
// @emurgo/cardano-serialization-lib-nodejs) was tried first and rejected:
// both threw "Deserialization failed... expected 'Array' byte received
// 'Tag'" on a real, valid, mainnet-confirmed transaction -- CBOR tag 258,
// the "set" encoding Cardano now uses for transaction inputs, which both
// choked on regardless of version. A generic decoder doesn't validate
// Cardano-specific set semantics, so it decodes tag 258 as a plain JS Set
// and moves on -- verified against that same real transaction's
// independently-confirmed fee (500000 lovelace, via Blockfrost) as ground
// truth, not a synthetic test, and tested against a non-Minswap
// transaction (a plain wallet sweep) to confirm this is genuinely
// platform-agnostic.
export function getTxFee(cborHex: string): bigint {
  const decoded = decodeFirstSync(Buffer.from(cborHex, "hex"));
  const body = decoded[0] as Map<number, unknown>;
  return BigInt(body.get(2) as number | string | bigint);
}
