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
