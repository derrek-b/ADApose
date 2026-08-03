export function formatAda(amount: number | null): string {
  if (amount === null) return "—";
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount)} ADA`;
}

export function formatApr(apr: { value: number; actualDays: number } | null): string {
  if (apr === null) return "—";
  return `${apr.value.toFixed(2)}%`;
}

export function formatAddress(address: string): string {
  const prefix = address.startsWith("addr_test1") ? "addr_test1" : "addr1";
  if (address.length <= prefix.length + 8) return address;
  const payload = address.slice(prefix.length);
  return `${prefix}${payload.slice(0, 4)}...${address.slice(-4)}`;
}
