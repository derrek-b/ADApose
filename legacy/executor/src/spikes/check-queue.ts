import { config } from "dotenv";
config({ path: ".env.local" });
import { Blockfrost, Lucid } from "@spacebudz/lucid";
import { DexV2Constant, NetworkId } from "@minswap/sdk";

const lucid = new Lucid({
  provider: new Blockfrost(process.env.BLOCKFROST_BASE_URL!, process.env.BLOCKFROST_PROJECT_ID!),
  network: "Preprod",
});
const cfg = DexV2Constant.CONFIG[NetworkId.TESTNET];
console.log("orderScriptHash:", cfg.orderScriptHash);
console.log("orderScriptHashBech32 (SDK's own encoding):", cfg.orderScriptHashBech32);
console.log("orderEnterpriseAddress (SDK's known enterprise-only order addr):", cfg.orderEnterpriseAddress);

const queried = await lucid.utxosAt({ type: "Script", hash: cfg.orderScriptHash });
console.log("\nutxosAt({Script, hash: orderScriptHash}) count:", queried.length);

const direct = await lucid.utxosAt(cfg.orderEnterpriseAddress);
console.log("utxosAt(orderEnterpriseAddress) count:", direct.length);

console.log("\nsame set?", queried.length === direct.length &&
  new Set(queried.map(u=>u.txHash+u.outputIndex)).size === new Set(direct.map(u=>u.txHash+u.outputIndex)).size);

const ourOrderAddr = "addr_test1zrdf2f2x8pq3wwk3yv936ksmt59rz94mm66yzge8zj9pk7ne9udap2el30u4tq4t07dmkwec7fzuggzg53dsuv35zv4sy8gqzq";
const ours = await lucid.utxosAt(ourOrderAddr);
console.log("\nour own (stake-tied) order address count:", ours.length);
const ourInQueried = queried.filter(u => u.address === ourOrderAddr);
console.log("of those, how many appear in the earlier 'queue-wide' credential query:", ourInQueried.length);
