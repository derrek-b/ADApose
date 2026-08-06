import { useQuery } from "@tanstack/react-query";

import { useWallet } from "@/components/wallet/wallet-context";

// One UTXO fetch per connected address, reused for every asset unit asked
// about -- opening a modal with two AmountFields costs one fetch, not two,
// since the per-unit balance below is a plain derived sum over the same
// cached UTXO list, not a second query.
export function useWalletBalance(unit: string) {
  const { status, lucid, address } = useWallet();
  const enabled = status === "connected" && lucid !== null && address !== null;

  const query = useQuery({
    queryKey: ["wallet-utxos", address],
    queryFn: () => lucid!.utxosAt(address!),
    enabled,
  });

  const balance = query.data?.reduce(
    (sum, utxo) => sum + (utxo.assets[unit] ?? 0n),
    0n,
  );

  return { balance, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
