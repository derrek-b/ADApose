import { Lucid, type Cardano } from "@spacebudz/lucid";

declare global {
  interface Window {
    cardano?: Cardano;
  }
}

export type CipWalletEntry = {
  key: string;
  name: string;
  icon: string;
};

export function discoverWallets(): CipWalletEntry[] {
  const cardano = window.cardano ?? {};
  return Object.entries(cardano)
    .filter(([, entry]) => typeof entry.enable === "function")
    .map(([key, entry]) => ({ key, name: entry.name, icon: entry.icon }));
}

export type ConnectedWallet = {
  key: string;
  lucid: Lucid;
  address: string;
  walletName: string;
  walletIcon: string;
  network: "mainnet" | "testnet";
};

export async function connectWallet(key: string): Promise<ConnectedWallet> {
  const entry = window.cardano?.[key];
  if (!entry) {
    throw new Error(`No wallet found for "${key}"`);
  }

  const api = await entry.enable();

  // Read-only, for display — never gates the connection. `Addresses.inspect`
  // (what `wallet.address()` uses) parses the network encoded in the wallet's
  // own address bytes, not whatever `network` this Lucid instance is given.
  const networkId = await api.getNetworkId();
  const network: "mainnet" | "testnet" = networkId === 1 ? "mainnet" : "testnet";

  const lucid = new Lucid({});
  lucid.selectWalletFromApi(api);
  const address = await lucid.wallet.address();

  return { key, lucid, address, walletName: entry.name, walletIcon: entry.icon, network };
}

// CIP-30 defines `code: -3` ("Refused") for a user declining the connection
// popup. Not every wallet's rejection object conforms exactly, so this also
// falls back to matching common wording as a backstop.
export function isUserCancellation(err: unknown): boolean {
  if (err && typeof err === "object" && (err as { code?: unknown }).code === -3) {
    return true;
  }
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "info" in err
        ? String((err as { info?: unknown }).info)
        : String(err);
  return /cancel|declin|refus|reject/i.test(message);
}
