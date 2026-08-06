export function formatAda(amount: number | null): string {
  if (amount === null) return "—";
  return `${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount)} ADA`;
}

export function formatTokenAmount(raw: bigint | undefined, decimals: number | undefined): string {
  if (raw === undefined || decimals === undefined) return "—";
  const amount = Number(raw) / 10 ** decimals;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount);
}

// Inverse of formatTokenAmount -- string-based decimal shifting, not
// float multiplication, so large amounts don't lose precision. Truncates
// (doesn't round) any precision beyond `decimals`, since that's not a real
// on-chain quantity to begin with.
export function parseTokenAmount(decimalString: string, decimals: number): bigint {
  const trimmed = decimalString.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return 0n;
  const [whole, fraction = ""] = trimmed.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${whole || "0"}${paddedFraction}` || "0");
}

// Inverse-ish of parseTokenAmount. Two uses: filling an editable input (e.g.
// a "Max" button), where formatTokenAmount's compact notation ("1.2K") isn't
// a valid <input type="number"> value; and full-precision read-only display
// (e.g. a review screen) where compact rounding would understate exactly
// what's about to be submitted. String-based, same precision rationale as
// parseTokenAmount -- no float division.
export function formatTokenAmountForInput(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const padded = abs.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const result = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${result}` : result;
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
