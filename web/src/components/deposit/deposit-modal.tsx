"use client";

import { useEffect, useMemo, useState } from "react";

import { getLPQuote, getPlatformCosts } from "@lib/adapters/minswap-quote";

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
import { EXECUTION_FEE, getRequiredAdaReserve } from "@/lib/deposit-costs";
import { formatTokenAmount, formatTokenAmountForInput, parseTokenAmount } from "@/lib/format";
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
const ADA_UNIT = "lovelace";

function parseAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Non-ADA field: Max fills the full balance. ADA-denominated field: Max
// fills balance minus the required reserve (platform costs + our fee +
// network-fee estimate -- see deposit-costs.ts), clamped to 0, so clicking
// Max never itself produces an amount that fails the sufficient-funds check
// below.
function computeMaxFill(
  isAda: boolean,
  decimals: number | undefined,
  ownBalance: bigint | undefined,
  adaBalance: bigint | undefined,
  requiredAdaReserve: bigint,
): string | undefined {
  if (decimals === undefined) return undefined;
  const balance = isAda ? adaBalance : ownBalance;
  if (balance === undefined) return undefined;
  const target = isAda ? (balance > requiredAdaReserve ? balance - requiredAdaReserve : 0n) : balance;
  return formatTokenAmountForInput(target, decimals);
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
  const [step, setStep] = useState<"input" | "review">("input");
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
  // Always called, regardless of whether either pool asset is ADA -- cheap
  // even when redundant with balanceA/balanceB (same wallet-utxos query,
  // keyed by address only, so this never triggers a second network fetch,
  // just a second in-memory reduce over the already-cached UTXO list). Used
  // uniformly below as *the* ADA balance rather than conditionally picking
  // between balanceA/balanceB.
  const balanceAda = useWalletBalance(ADA_UNIT);
  const { poolState, isLoading: poolStateLoading, isError: poolStateError } =
    useMinswapPoolState(assetA, assetB);

  // This modal is a single, always-mounted instance in PoolTable -- pool/open
  // just toggle as props, the component itself never unmounts. That means
  // useWalletBalance's underlying query (enabled purely by wallet-connection
  // status, not by pool/open) never gets a natural "new observer mounted"
  // trigger to refetch on a fresh open -- it just keeps whatever it last
  // fetched, however stale, until something else (window refocus, a full
  // page reload) happens to trigger a refetch. Explicitly refetching on
  // every open closes that gap. balanceA/balanceB/balanceAda all share the
  // same underlying query key (["wallet-utxos", address]), so refetching
  // through any one of them refreshes the cache for all three.
  useEffect(() => {
    if (open) balanceAda.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever
    // wants to fire on an open transition, not on every balanceAda re-render.
  }, [open]);

  const rawA = decimalsA.decimals !== undefined ? parseTokenAmount(amountA, decimalsA.decimals) : undefined;
  const rawB = decimalsB.decimals !== undefined ? parseTokenAmount(amountB, decimalsB.decimals) : undefined;

  const lpQuote = useMemo(() => {
    if (!poolState || rawA === undefined || rawB === undefined) return undefined;
    if (rawA === 0n && rawB === 0n) return undefined;
    return getLPQuote({ amountA: rawA, amountB: rawB, pool: poolState });
  }, [poolState, rawA, rawB]);

  if (!pool) return null;

  const [labelA, labelB = "Asset B"] = pool.pair.split("/");
  const signatureBehavior = ZAP_IN_SIGNATURE_BEHAVIOR[pool.venue] ?? "sometimes-two";

  const isAssetAAda = assetA === ADA_UNIT;
  const isAssetBAda = assetB === ADA_UNIT;
  const requiredAdaReserve = getRequiredAdaReserve();

  // Per-asset sufficient-funds check: sum everything actually leaving the
  // wallet in a given asset, check against that asset's balance. ADA sums
  // its own deposit-leg amount (zero if neither pool asset is ADA) plus the
  // reserve, since Minswap's fees are always paid in ADA regardless of what
  // else is being deposited -- this must be a sum, not two independent
  // checks against the same balance, or a wallet could pass both without
  // actually having enough for both at once. See docs/workflows/zap-in.md's
  // "Review step" section for the full reasoning.
  const hasAmount = (rawA ?? 0n) > 0n || (rawB ?? 0n) > 0n;
  const adaReady = balanceAda.balance !== undefined;
  const aReady = isAssetAAda || (rawA !== undefined && balanceA.balance !== undefined);
  const bReady = isAssetBAda || (rawB !== undefined && balanceB.balance !== undefined);
  const allReady = adaReady && aReady && bReady;

  const adaNeeded = requiredAdaReserve + (isAssetAAda ? rawA ?? 0n : 0n) + (isAssetBAda ? rawB ?? 0n : 0n);
  const adaOk = !adaReady || balanceAda.balance! >= adaNeeded;
  const aOk = isAssetAAda || !aReady || rawA! <= balanceA.balance!;
  const bOk = isAssetBAda || !bReady || rawB! <= balanceB.balance!;

  const canReview = hasAmount && allReady && adaOk && aOk && bOk;

  let blockReason: string | null = null;
  if (hasAmount && allReady) {
    if (!adaOk) {
      blockReason = `Insufficient ADA — need ${formatTokenAmountForInput(adaNeeded, 6)} ADA available for the deposit and transaction costs.`;
    } else if (!aOk) {
      blockReason = `Insufficient ${labelA} balance.`;
    } else if (!bOk) {
      blockReason = `Insufficient ${labelB} balance.`;
    }
  }

  const maxFillA = computeMaxFill(isAssetAAda, decimalsA.decimals, balanceA.balance, balanceAda.balance, requiredAdaReserve);
  const maxFillB = computeMaxFill(isAssetBAda, decimalsB.decimals, balanceB.balance, balanceAda.balance, requiredAdaReserve);

  const reserveFooter =
    isAssetAAda || isAssetBAda
      ? `≈ ${formatTokenAmountForInput(requiredAdaReserve, 6)} ADA needs to stay available in your wallet for transaction costs.`
      : `Your wallet also needs ≈ ${formatTokenAmountForInput(requiredAdaReserve, 6)} ADA available (separate from the amounts above) for transaction costs.`;

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
            {step === "input" ? `Zap into ${pool.pair} (${pool.venue})` : "Review deposit"}
          </DialogTitle>
        </DialogHeader>

        {step === "input" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <AmountField
                label={labelA}
                value={amountA}
                onChange={setAmountA}
                onMax={maxFillA !== undefined ? () => setAmountA(maxFillA) : undefined}
                decimals={decimalsA.decimals}
                balance={balanceA.balance}
                isLoading={decimalsA.isLoading || balanceA.isLoading}
                isError={decimalsA.isError || balanceA.isError}
              />
              <AmountField
                label={labelB}
                value={amountB}
                onChange={setAmountB}
                onMax={maxFillB !== undefined ? () => setAmountB(maxFillB) : undefined}
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

            <p className="text-xs text-muted-foreground">{reserveFooter}</p>

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

            {blockReason && <p className="text-xs text-destructive">{blockReason}</p>}
          </div>
        ) : (
          <ReviewStep
            labelA={labelA}
            labelB={labelB}
            rawA={rawA ?? 0n}
            rawB={rawB ?? 0n}
            decimalsA={decimalsA.decimals ?? 0}
            decimalsB={decimalsB.decimals ?? 0}
            lpQuote={lpQuote}
            slippage={slippage}
          />
        )}

        <DialogFooter>
          {step === "input" ? (
            <Button disabled={!canReview} onClick={() => setStep("review")}>
              Review Deposit
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setStep("input")}>
                Back
              </Button>
              {/* TODO: build + sign the real transaction -- no tx execution yet, see docs/workflows/zap-in.md */}
              <Button disabled title="Not implemented yet">
                Confirm &amp; Sign
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewStep({
  labelA,
  labelB,
  rawA,
  rawB,
  decimalsA,
  decimalsB,
  lpQuote,
  slippage,
}: {
  labelA: string;
  labelB: string;
  rawA: bigint;
  rawB: bigint;
  decimalsA: number;
  decimalsB: number;
  lpQuote: bigint | undefined;
  slippage: number;
}) {
  const platformCosts = getPlatformCosts();
  const nonRefundableCosts = platformCosts.filter((c) => !c.refundable);
  const refundableCosts = platformCosts.filter((c) => c.refundable);

  const slippageBps = BigInt(Math.round(slippage * 100));
  const minimumLpOut = lpQuote === undefined ? undefined : lpQuote - (lpQuote * slippageBps) / 10000n;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{labelA}</span>
          <span>{formatTokenAmountForInput(rawA, decimalsA)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{labelB}</span>
          <span>{formatTokenAmountForInput(rawB, decimalsB)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Estimated LP out</span>
          <span>{lpQuote === undefined ? "—" : lpQuote.toLocaleString("en-US")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Minimum received ({slippage}% slippage)</span>
          <span>{minimumLpOut === undefined ? "—" : minimumLpOut.toLocaleString("en-US")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="mb-1">Costs</Label>
        {nonRefundableCosts.map((cost) => (
          <div key={cost.description} className="flex justify-between text-muted-foreground">
            <span>{cost.description}</span>
            <span>{formatTokenAmountForInput(cost.amount, 6)} ADA</span>
          </div>
        ))}
        <div className="flex justify-between text-muted-foreground">
          <span>ADApose fee</span>
          <span>{formatTokenAmountForInput(EXECUTION_FEE, 6)} ADA</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Network fee</span>
          {/* Real fee only exists once an actual transaction is built --
              not implemented yet, so this is an honest placeholder rather
              than a fabricated number. See docs/workflows/zap-in.md. */}
          <span>calculated when you continue</span>
        </div>
        {refundableCosts.map((cost) => (
          <div key={cost.description} className="flex justify-between text-muted-foreground">
            <span>{cost.description}</span>
            <span>{formatTokenAmountForInput(cost.amount, 6)} ADA</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AmountField({
  label,
  value,
  onChange,
  onMax,
  decimals,
  balance,
  isLoading,
  isError,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onMax?: () => void;
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
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button type="button" size="sm" variant="outline" disabled={!onMax} onClick={onMax}>
          Max
        </Button>
      </div>
    </div>
  );
}
