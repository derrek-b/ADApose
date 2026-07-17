// Smoke test: proves .env.local + Blockfrost + Lucid + executor seed all cooperate.
// Run: npx tsx src/smoke-test.ts   (from executor/)
// Prints the executor address and its current tADA balance. No transactions sent.

import { config } from "dotenv";
import { Blockfrost, Lucid } from "@spacebudz/lucid";

config({ path: ".env.local" });

const projectId = process.env.BLOCKFROST_PROJECT_ID;
const baseUrl =
  process.env.BLOCKFROST_BASE_URL ?? process.env.BLACKFROST_BASE_URL; // tolerate typo
const seed = process.env.EXECUTOR_SEED_PHRASE;
const network = process.env.NETWORK ?? "preprod";

if (!projectId || !baseUrl || !seed) {
  throw new Error("Missing env: need BLOCKFROST_PROJECT_ID, BLOCKFROST_BASE_URL, EXECUTOR_SEED_PHRASE");
}

const lucid = new Lucid({
  provider: new Blockfrost(baseUrl, projectId),
  network: network.toLowerCase() === "mainnet" ? "Mainnet" : "Preprod",
});

lucid.selectWalletFromSeed(seed.trim());

const address = await lucid.wallet.address();
console.log("executor address:", address);

const utxos = await lucid.wallet.getUtxos();
const lovelace = utxos.reduce((sum, u) => sum + (u.assets.lovelace ?? 0n), 0n);
console.log("utxos:", utxos.length);
console.log("balance:", Number(lovelace) / 1_000_000, "tADA");

if (utxos.length === 0) {
  console.log("\n→ fund it: https://docs.cardano.org/cardano-testnets/tools/faucet (Preprod), paste the address above");
}
