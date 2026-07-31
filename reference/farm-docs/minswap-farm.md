## 1. Co-signing — confirmed, and here's the API to get transactions built

Yes, that's correct and intended. Any interaction that **spends** a farm position — harvest, stake-more, partial withdraw, withdraw-all, migrations — requires the Minswap co-signature alongside the position owner. Concretely, these spends carry **three** required signers:

- the position **owner** (payment pubkey hash), and
- Minswap keys

The co-signing is not something a third-party contract can obtain on its own — it is produced **server-side by the Minswap backend**. The supported, permitted flow is: **you call our farm GraphQL API, the backend assembles the transaction and co-signs it with the Minswap farm keys, and returns a partially-signed CBOR transaction. Your app then adds the owner's signature and submits.** There is no other channel for a farm spend to be co-signed — going through this API *is* the official integration path.

> Note: the mutations below live on https://k-app-monorepo-mainnet-prod.minswap.org/graphql

### Common conventions

- **Return type:** every mutation returns a bare `String!` — the **CBOR-hex transaction, already co-signed by Minswap**. Your wallet only needs to add the owner signature and submit. There is no wrapper object / no sub-fields.
- **`amount`** fields are `BigInt` LP-token amounts (raw on-chain units).
- **`inputsToChoose`** / **`collateralUtxos`** are arrays of the owner's UTxO references the builder may spend / use as collateral.
- **`hasLBBonus`** must be `true` only for Launch Bowl "Exclusive" farms; use `false` for standard farms.

### Shared input types

```graphql
"""Common options to build a Yield Farming transaction"""
input FarmTx {
  "Address of the staking position's owner"
  owner: String!
  "LP token of the Yield Farming pool"
  lpAsset: String!
  "Whether the pool belongs to a Launch Bowl event"
  hasLBBonus: Boolean!
  "Owner UTxOs that may be spent in the transaction"
  inputsToChoose: [String!]!
  "Use Minswap's UTxO-selection algorithm"
  useCoinSelectionStrategy: Boolean!
  "Split the change UTxO into smaller UTxOs"
  shouldSplitChange: Boolean
}

"""Only needed for Launch Bowl / Exclusive farms (functional NFT whitelist)"""
input InputAsset {
  currencySymbol: String!
  tokenName: String!
}
```

### 1a. First stake (create a new position)

Separate mutation from "stake more" — it fails if the owner already has a position.

```graphql
input BuildFirstDepositTxOptions {
  farmTx: FarmTx!
  amount: BigInt!
  lbWhitelistAssets: [InputAsset!]   # required only when hasLBBonus = true
}

mutation BuildFirstDeposit($options: BuildFirstDepositTxOptions!) {
  buildFirstDepositV2(options: $options)   # returns co-signed CBOR tx (String)
}
```

### 1b. Stake more (add to an existing position)

```graphql
input BuildStakeDepositOptions {
  farmTx: FarmTx!
  amount: BigInt!                          # additional LP to stake
  collateralUtxos: [String!]!
  additionalLbWhitelistAssets: [InputAsset!]  # Exclusive farms only
}

mutation BuildStakeDeposit($options: BuildStakeDepositOptions!) {
  buildStakeDepositV2(options: $options)
}
```

### 1c. Partial withdraw

`amount` is the LP to withdraw; the remaining balance must stay **> 0** (use "withdraw all" to fully exit).

```graphql
input BuildStakeWithdrawOptions {
  farmTx: FarmTx!
  amount: BigInt!                          # LP amount to withdraw
  collateralUtxos: [String!]!
}

mutation BuildStakeWithdraw($options: BuildStakeWithdrawOptions!) {
  buildStakeWithdrawV2(options: $options)
}
```

### 1d. Withdraw all

```graphql
input BuildStakeWithdrawAllOptions {
  farmTx: FarmTx!
  collateralUtxos: [String!]!
}

mutation BuildStakeWithdrawAll($options: BuildStakeWithdrawAllOptions!) {
  buildStakeWithdrawAllV2(options: $options)
}
```

### 1e. Harvest (claim rewards) — bonus, for compounding

Harvest supports **multiple pools in a single transaction** and uses its own input shape (not `FarmTx`):

```graphql
input HarvestPool {
  lpAsset: String!
  hasLBBonus: Boolean!
}

input BuildMultipleHarvestsOptions {
  owner: String!
  pools: [HarvestPool!]!
  inputsToChoose: [String!]!
  useCoinSelectionStrategy: Boolean!
  collateralUtxos: [String!]!
  shouldSplitChange: Boolean
}

mutation BuildMultipleHarvests($options: BuildMultipleHarvestsOptions!) {
  buildMultipleHarvestsV2(options: $options)
}
```

---

## 2. Owner-only exit — yes, via emergency withdraw

Yes. If the co-signer were ever unavailable, an owner can reclaim their staked LP with **only their own signature**. This is the `EMERGENCY_WITHDRAW` redeemer (constructor index `3`), and it is deliberately **not** gated on the Minswap co-signature — the only required signer is the position owner. The trade-off: it returns the staked LP (and any functional NFTs) to the owner **without harvesting pending rewards** — those are forfeited. It's an escape hatch, not the everyday exit.

There are two ways to use it:

**(a) Via our API** (convenient — Minswap sponsors the collateral for you):

```graphql
input BuildEmergencyWithdrawOptions {
  farmTx: FarmTx!
  collateralUtxos: [String!]!
}

mutation BuildEmergencyWithdraw($options: BuildEmergencyWithdrawOptions!) {
  buildEmergencyWithdrawV2(options: $options)
}
```

Note: unlike the normal spends, this transaction is **not** co-signed with the Minswap farm keys — the only farm-authorization signature is the owner's. (The backend attaches a sponsored collateral input signed by a Minswap collateral-sponsor key, but that's only to fund the Plutus collateral; it is not part of the owner-authorization path and does not appear in `required_signers` for the staking spend.)

**(b) Build it yourself, fully trustless** — because the redeemer only checks `txSignedBy(ownerPkh)`, you can construct the emergency-withdraw transaction entirely on your own (spend the staking UTxO with redeemer constructor `3`, pay the value back to the owner, supply your own collateral) and sign it with **only the owner's key**. No Minswap involvement at all. This is the guarantee that a user's funds are never held hostage by the co-signer's availability.

---

## 3. Script-owned positions — not supported

Confirmed: **script/contract addresses cannot own a farm position today.** Owner auth is a plain pubkey-hash required-signer check (`txSignedBy(ownerPkh)`), and the owner's payment credential must resolve to a **public-key hash**. 

---

## 4. Composability — welcome

Yes — you're welcome to build automated compounding on top of Minswap farms, and the flow above **is** the official integration path: use the farm GraphQL mutations to get Minswap-co-signed transactions, add the owner signature, and submit. The emergency-withdraw redeemer guarantees users can always exit unilaterally. Reach out and we'll help provision key-API access and answer anything else as you spec it out.

**Update (2026-07-31), Minswap team via Discord:** the "provision key-API access" line above is superseded — an API key is not required. "You don't need the API key to use it. ... You can leave the API key cuz the current rate limit is enough for almost all use cases." They also pointed at a new package, `@minswap/sdk-v2` (npm), which wraps this same GraphQL API behind a typed `sdk.farm` client (`deposit`/`withdraw`/`harvest`/`emergencyWithdraw`) — vendored at `reference/minswap-sdk-v2/`. Full record: `docs/decisions.md` D19 addendum, 2026-07-31.
