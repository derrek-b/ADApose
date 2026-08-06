"use client";

import { useMemo, useState } from "react";

import { getLPQuote } from "@lib/adapters/minswap-quote";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssetDecimals } from "@/hooks/use-asset-decimals";
import { useMinswapPoolState } from "@/hooks/use-minswap-pool-state";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";
import type { PoolRow } from "@/lib/pool-row";

// v1 is Minswap-only, and Minswap settles any combination (single- or
// two-sided, any ratio) in one order -- no second signature ever needed. A
// venue that can't zap in internally would need a separate swap-then-deposit
// flow (2 signatures) -- see docs/workflows/zap-in.md's "Multi-leg
// composition" section. Keyed by venue so adding that venue later is a
// one-line addition here, not a rewrite.
const ZAP_IN_SIGNATURE_BEHAVIOR: Record<string, "always-one" | "sometimes-two"> = {
  "minswap-v2": "always-one",
};

const SLIPPAGE_PRESETS = [0.5, 1, 2];

function parseAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function DepositModal({
  pool,
  open,
  onOpenChange,
}: {
  pool: PoolRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [customSlippage, setCustomSlippage] = useState("");

  // "" when there's no pool yet -- every hook below needs to be called
  // unconditionally regardless, so each is written to treat an empty unit as
  // "nothing to fetch" rather than being skipped via an early return here.
  const assetA = pool?.identity.assetA ?? "";
  const assetB = pool?.identity.assetB ?? "";

  const decimalsA = useAssetDecimals(assetA);
  const decimalsB = useAssetDecimals(assetB);
  const balanceA = useWalletBalance(assetA);
  const balanceB = useWalletBalance(assetB);
  const { poolState, isLoading: poolStateLoading, isError: poolStateError } =
    useMinswapPoolState(assetA, assetB);

  const lpQuote = useMemo(() => {
    if (!poolState || decimalsA.decimals === undefined || decimalsB.decimals === undefined) {
      return undefined;
    }
    const rawA = parseTokenAmount(amountA, decimalsA.decimals);
    const rawB = parseTokenAmount(amountB, decimalsB.decimals);
    if (rawA === 0n && rawB === 0n) return undefined;
    return getLPQuote({ amountA: rawA, amountB: rawB, pool: poolState });
  }, [poolState, decimalsA.decimals, decimalsB.decimals, amountA, amountB]);

  if (!pool) return null;

  const [labelA, labelB = "Asset B"] = pool.pair.split("/");
  const signatureBehavior = ZAP_IN_SIGNATURE_BEHAVIOR[pool.venue] ?? "sometimes-two";
  const canReview = parseAmount(amountA) > 0 || parseAmount(amountB) > 0;

  function handlePreset(pct: number) {
    setSlippage(pct);
    setCustomSlippage("");
  }

  function handleCustomSlippage(value: string) {
    setCustomSlippage(value);
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) setSlippage(n);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Zap into {pool.pair} ({pool.venue})
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <AmountField
              label={labelA}
              value={amountA}
              onChange={setAmountA}
              decimals={decimalsA.decimals}
              balance={balanceA.balance}
              isLoading={decimalsA.isLoading || balanceA.isLoading}
              isError={decimalsA.isError || balanceA.isError}
            />
            <AmountField
              label={labelB}
              value={amountB}
              onChange={setAmountB}
              decimals={decimalsB.decimals}
              balance={balanceB.balance}
              isLoading={decimalsB.isLoading || balanceB.isLoading}
              isError={decimalsB.isError || balanceB.isError}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {signatureBehavior === "always-one"
              ? "This platform settles any deposit in a single transaction."
              : "Single-sided or unbalanced amounts on this platform will trigger a swap transaction before the pool deposit."}
          </p>

          <div className="flex flex-col gap-2">
            <Label>Slippage tolerance</Label>
            <div className="flex items-center gap-2">
              {SLIPPAGE_PRESETS.map((pct) => (
                <Button
                  key={pct}
                  type="button"
                  size="sm"
                  variant={!customSlippage && slippage === pct ? "default" : "outline"}
                  onClick={() => handlePreset(pct)}
                >
                  {pct}%
                </Button>
              ))}
              <Input
                type="number"
                placeholder="Custom %"
                className="w-24"
                value={customSlippage}
                onChange={(e) => handleCustomSlippage(e.target.value)}
              />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Estimated LP out:{" "}
            {poolStateError ? (
              <span className="text-destructive">Err</span>
            ) : poolStateLoading ? (
              <Skeleton className="inline-block h-3 w-12 align-middle" />
            ) : (
              <span className="text-foreground">
                {lpQuote === undefined ? "—" : lpQuote.toLocaleString("en-US")}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button disabled={!canReview} onClick={() => {/* TODO: review step */}}>
            Review Deposit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AmountField({
  label,
  value,
  onChange,
  decimals,
  balance,
  isLoading,
  isError,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimals: number | undefined;
  balance: bigint | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {isError ? (
          <span className="text-xs text-destructive">Balance: Err</span>
        ) : isLoading ? (
          <Skeleton className="h-3 w-16" />
        ) : (
          <span className="text-xs text-muted-foreground">
            Balance: {formatTokenAmount(balance, decimals)}
          </span>
        )}
      </div>
      <Input
        type="number"
        min="0"
        placeholder="0.0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
