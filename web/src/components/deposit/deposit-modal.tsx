"use client";

import { Codec } from "@spacebudz/lucid";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { getClientAdapter } from "@lib/adapters/registry-client";

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
import { connectWallet, type ConnectedWallet } from "@/components/wallet/cip30";
import { useWallet } from "@/components/wallet/wallet-context";
import { useAssetDecimals } from "@/hooks/use-asset-decimals";
import { usePoolState } from "@/hooks/use-pool-state";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { EXECUTION_FEE } from "@/lib/deposit-costs";
import { formatTokenAmount, formatTokenAmountForInput, parseTokenAmount } from "@/lib/format";
import type { PoolRow } from "@/lib/pool-row";

const BUILD_TTL_MS = 30_000;

type BuildResult = {
  cbor: string;
  fee: bigint;
  // What was actually requested for this build -- captured directly from
  // this call's own input (see buildDepositOrderRequest below), not read
  // back from component state, so it can't be confused with a later
  // render's amountA/amountB once the fields get synced to the adjusted
  // values below.
  requestedAmountA: bigint;
  requestedAmountB: bigint;
  // The amount(s) actually used to build -- may be lower than what was
  // requested if the server's internal retry loop (build-deposit/route.ts)
  // had to reduce one to find a working combination. Always present, equal
  // to the request when no adjustment was needed.
  adjustedAmountA: bigint;
  adjustedAmountB: bigint;
  connectedWallet: ConnectedWallet;
};
type BuildError = Error & {
  status?: number;
  asset?: string;
  // Single-round shortfall, still used for the ADA-outside-the-pool case
  // (no retry lever to pull there -- see route.ts).
  missingQty?: bigint;
  // Set instead of missingQty when the server's retry loop ran out of
  // rounds (or hit the floor) without finding a working amount -- the
  // lowest amount actually tried for `asset`, which still failed.
  lastTriedAmount?: bigint;
};

async function buildDepositOrderRequest(input: {
  walletKey: string | null;
  venue: string;
  assetA: string;
  assetB: string;
  amountA: bigint;
  amountB: bigint;
  slippage: number;
}): Promise<BuildResult> {
  const { walletKey, venue, assetA, assetB, amountA, amountB, slippage } = input;
  if (!walletKey) throw new Error("Wallet not connected");

  // Always reconnect first, rather than reusing whatever lucid instance is
  // already in context -- confirmed via extensive live testing (not
  // assumed) that the wallet extension's own background channel can go
  // stale within well under a minute of normal use (not a rare edge case),
  // with no reliable way to detect that in advance short of trying it.
  // connectWallet's enable() call is silent for an already-authorized
  // origin (confirmed for Lace) and this is pure browser-to-extension
  // communication -- no Blockfrost call, no server round-trip, so refreshing
  // unconditionally costs nothing extra even on the common case where the
  // old connection was still fine. See docs/workflows/zap-in.md.
  const connectedWallet = await connectWallet(walletKey);
  const { lucid } = connectedWallet;

  const [utxos, sender] = await Promise.all([lucid.wallet.getUtxos(), lucid.wallet.address()]);
  const walletUtxoCbors = utxos.map((utxo) => Codec.encodeUtxo(utxo));

  const res = await fetch("/api/build-deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      venue,
      sender,
      walletUtxoCbors,
      assetA,
      assetB,
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      slippage,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error ?? `Build failed (${res.status})`) as BuildError;
    err.status = res.status;
    if (data.asset !== undefined && data.missingQty !== undefined) {
      err.asset = data.asset;
      err.missingQty = BigInt(data.missingQty);
    }
    if (data.asset !== undefined && data.lastTriedAmount !== undefined) {
      err.asset = data.asset;
      err.lastTriedAmount = BigInt(data.lastTriedAmount);
    }
    throw err;
  }
  return {
    cbor: data.cbor as string,
    fee: BigInt(data.fee),
    requestedAmountA: amountA,
    requestedAmountB: amountB,
    adjustedAmountA: BigInt(data.adjustedAmountA),
    adjustedAmountB: BigInt(data.adjustedAmountB),
    connectedWallet,
  };
}

const SLIPPAGE_PRESETS = [0.5, 1, 2];
const ADA_UNIT = "lovelace";

// Max means wallet balance, full stop -- standard DeFi convention, not
// something to second-guess with an estimate (a made-up ADA reserve used to
// try this; live testing proved that class of estimate can be wrong in ways
// no fixed constant fixes -- see docs/workflows/zap-in.md). The one
// exception: once a real build has told us the *exact* safe amount for this
// asset (learnedMax, set from a real "insufficient balance" failure), reuse
// that real number instead of guessing again.
function computeMaxFill(
  decimals: number | undefined,
  balance: bigint | undefined,
  learnedMax: bigint | undefined,
): string | undefined {
  if (decimals === undefined || balance === undefined) return undefined;
  const target = learnedMax !== undefined ? learnedMax : balance;
  return formatTokenAmountForInput(target, decimals);
}

// Shared between the Input step (always visible -- the real itemized
// numbers, replacing a former "~X ADA" guess) and Review (with the
// network-fee row, only meaningful once a real build exists, inserted via
// `extra`). Same real numbers either place, not duplicated logic.
// `platformCosts` comes from the caller (looked up via getClientAdapter for
// this pool's own venue) rather than a hardcoded import, so this component
// has no DEX-specific knowledge of its own.
function CostBreakdown({
  platformCosts,
  extra,
}: {
  platformCosts: { amount: bigint; description: string; refundable: boolean }[];
  extra?: ReactNode;
}) {
  const nonRefundableCosts = platformCosts.filter((c) => !c.refundable);
  const refundableCosts = platformCosts.filter((c) => c.refundable);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <Label className="mb-1">Fixed Costs</Label>
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
      {extra}
      {refundableCosts.map((cost) => (
        <div key={cost.description} className="flex justify-between text-muted-foreground">
          <span>{cost.description}</span>
          <span>{formatTokenAmountForInput(cost.amount, 6)} ADA</span>
        </div>
      ))}
    </div>
  );
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
  const [builtAt, setBuiltAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The exact amount(s) a real successful build actually used, keyed by
  // asset unit -- reset on every fresh modal open, not on pool identity
  // (confirmed in design discussion: even the same pool's UTXO set changes
  // after a successful deposit, so "same pool" isn't a safe boundary --
  // "nothing has changed since this open" is the only one we can actually
  // vouch for). Per-asset (not a single slot) since the server's retry
  // loop (build-deposit/route.ts) can in principle adjust either asset,
  // not just whichever one happened to be ADA.
  const [learnedMax, setLearnedMax] = useState<Record<string, bigint>>({});
  // Set right before onSuccess/onError programmatically corrects an amount
  // field (server-adjusted amounts on success; nothing on the matched-error
  // path anymore, but the mechanism stays generic), so the amount-change
  // effect below (which clears a stale build result whenever the user edits
  // a field) doesn't immediately wipe out the result that correction is
  // part of. Consumed once, by the next amount-change effect run, then
  // cleared.
  const skipNextResetRef = useRef(false);

  const { walletKey, finishConnecting } = useWallet();

  // "" when there's no pool yet -- every hook below needs to be called
  // unconditionally regardless, so each is written to treat an empty unit as
  // "nothing to fetch" rather than being skipped via an early return here.
  const venue = pool?.venue ?? "";
  const assetA = pool?.identity.assetA ?? "";
  const assetB = pool?.identity.assetB ?? "";

  const decimalsA = useAssetDecimals(assetA);
  const decimalsB = useAssetDecimals(assetB);
  const balanceA = useWalletBalance(assetA);
  const balanceB = useWalletBalance(assetB);
  const {
    poolState,
    isLoading: poolStateLoading,
    isError: poolStateError,
    isFetching: poolStateFetching,
    refetch: refetchPoolState,
  } = usePoolState(venue, assetA, assetB);

  // Builds the real, unsigned order server-side (gathering this wallet's
  // UTXOs client-side first -- see buildDepositOrderRequest above, which
  // always reconnects the wallet before touching its API) to get the real
  // network fee. Its own retry predicate, not the QueryClient default: a
  // 400 (insufficient funds, confirmed by actually triggering it -- see
  // docs/workflows/zap-in.md) will fail identically no matter how many
  // times it's retried, so only a 502/network failure gets retried. Since
  // the reconnect now happens fresh inside buildDepositOrderRequest itself,
  // a retry (unlike before) doesn't reuse a possibly-stale connection --
  // each attempt gets its own fresh one.
  const buildOrder = useMutation({
    mutationFn: () =>
      buildDepositOrderRequest({
        walletKey,
        venue,
        assetA,
        assetB,
        amountA: rawA ?? 0n,
        amountB: rawB ?? 0n,
        slippage,
      }),
    onSuccess: (result) => {
      setBuiltAt(Date.now());
      setStep("review");
      // Propagate the fresh connection app-wide, not just for this one
      // build -- everything else (balance queries, etc.) benefits from it
      // too rather than only this mutation seeing the refreshed wallet.
      finishConnecting(result.connectedWallet);

      // The server's retry loop (build-deposit/route.ts) may have reduced
      // one of the requested amounts to find a combination that actually
      // builds -- sync the fields (and learnedMax, for future Max clicks)
      // to the real, validated amounts, not what was originally typed.
      // Equal to what's already there when no adjustment was needed, so
      // this is a no-op in the common case. Skip the reset-on-amount-change
      // effect below just for this programmatic sync -- otherwise it would
      // immediately clear buildOrder.data (the cbor/fee Review just got).
      if (decimalsA.decimals !== undefined && decimalsB.decimals !== undefined) {
        skipNextResetRef.current = true;
        setAmountA(formatTokenAmountForInput(result.adjustedAmountA, decimalsA.decimals));
        setAmountB(formatTokenAmountForInput(result.adjustedAmountB, decimalsB.decimals));
        setLearnedMax((prev) => ({
          ...prev,
          [assetA]: result.adjustedAmountA,
          [assetB]: result.adjustedAmountB,
        }));
      }
    },
    onError: (error) => {
      console.error("buildDepositOrder failed:", error);
      const err = error as BuildError;
      if (err.asset === undefined || err.lastTriedAmount === undefined) return;
      const isA = err.asset === assetA;
      const isB = err.asset === assetB;
      // Unmatched (ADA required outside a token/token pool's own two
      // assets) -- no field to correct, nothing to auto-fill.
      if (!isA && !isB) return;
      const decimals = isA ? decimalsA.decimals : decimalsB.decimals;
      if (decimals === undefined) return;
      // The server's retry loop (build-deposit/route.ts) already tried this
      // amount and it still failed, so it isn't a "safe" value -- but it IS
      // the lowest amount actually reached, which makes it a better
      // starting point than leaving the original (definitely-too-high)
      // amount in place. Leaving the original would just reproduce the
      // exact same failing rounds on the next Preview click; starting from
      // here gives the next attempt a real chance at a different outcome
      // (coin selection can behave differently at a different amount, same
      // as it did across this failure's own rounds).
      skipNextResetRef.current = true;
      const formatted = formatTokenAmountForInput(err.lastTriedAmount, decimals);
      if (isA) setAmountA(formatted);
      else setAmountB(formatted);
      setLearnedMax((prev) => ({ ...prev, [err.asset as string]: err.lastTriedAmount as bigint }));
    },
    retry: (failureCount, error) => {
      const status = (error as BuildError).status;
      return failureCount < 2 && status !== 400;
    },
  });

  // This modal is a single, always-mounted instance in PoolTable -- pool/open
  // just toggle as props, the component itself never unmounts. That means
  // useWalletBalance's underlying query (enabled purely by wallet-connection
  // status, not by pool/open) never gets a natural "new observer mounted"
  // trigger to refetch on a fresh open -- it just keeps whatever it last
  // fetched, however stale, until something else (window refocus, a full
  // page reload) happens to trigger a refetch. Explicitly refetching on
  // every open closes that gap. balanceA/balanceB share the same underlying
  // query key (["wallet-utxos", address]), so refetching through either one
  // refreshes the cache for both. Also the reset boundary for learnedMax --
  // see its own declaration comment for why "fresh open," not pool identity.
  useEffect(() => {
    if (open) {
      balanceA.refetch();
      setLearnedMax({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever
    // wants to fire on an open transition, not on every balanceA re-render.
  }, [open]);

  // A stale build error/learned-max from a previous attempt shouldn't
  // linger once the user starts typing a different amount -- amount state
  // can only change while on Input (Review doesn't render the amount
  // fields), so this can't clear a successful result being shown on Review.
  // Skipped exactly once right after onError's own auto-fill (see
  // skipNextResetRef above) so that correction doesn't erase the error
  // message explaining it -- every other amount change (typing, Max) still
  // resets as before.
  useEffect(() => {
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    buildOrder.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only wants to
    // fire when the typed amounts change, not on every mutation identity
    // change.
  }, [amountA, amountB]);

  // Ticks once a second only while Review is showing, purely to force a
  // re-render so the countdown display advances -- the actual expiry check
  // below is a plain timestamp comparison, not driven by this state itself.
  useEffect(() => {
    if (step !== "review") return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [step]);

  const secondsRemaining =
    builtAt === null ? null : Math.max(0, Math.ceil((builtAt + BUILD_TTL_MS - now) / 1000));
  const isExpired = builtAt !== null && now - builtAt >= BUILD_TTL_MS;

  const rawA = decimalsA.decimals !== undefined ? parseTokenAmount(amountA, decimalsA.decimals) : undefined;
  const rawB = decimalsB.decimals !== undefined ? parseTokenAmount(amountB, decimalsB.decimals) : undefined;

  const lpQuote = useMemo(() => {
    if (!poolState || rawA === undefined || rawB === undefined || venue === "") return undefined;
    if (rawA === 0n && rawB === 0n) return undefined;
    return getClientAdapter(venue).getLPQuote({ amountA: rawA, amountB: rawB, pool: poolState });
  }, [poolState, rawA, rawB, venue]);

  if (!pool) return null;

  const [labelA, labelB = "Asset B"] = pool.pair.split("/");
  // Safe to call unguarded -- pool.venue is defined here (after the guard
  // above), and an unregistered venue can't currently reach the UI (see
  // lib/adapters/registry-client.ts's own comment on why it throws rather
  // than silently falling back).
  const clientAdapter = getClientAdapter(pool.venue);
  const signatureBehavior = clientAdapter.getSignatureBehavior();
  const platformCosts = clientAdapter.getPlatformCosts();

  // Balance-sufficient is advisory only, not a gate -- staleness cuts both
  // ways (the wallet's real balance could have gone up OR down since this
  // was last fetched), so a hard block risks incorrectly preventing an
  // attempt that would actually succeed. The real build (triggered by
  // Preview, with its own server-side retry loop -- build-deposit/route.ts)
  // is the only authority on whether an amount actually works; this is
  // just a free, instant hint using data already fetched for the balance
  // display, for the common case (typo, or genuinely not holding enough).
  const hasAmount = (rawA ?? 0n) > 0n || (rawB ?? 0n) > 0n;
  const aReady = rawA !== undefined && balanceA.balance !== undefined;
  const bReady = rawB !== undefined && balanceB.balance !== undefined;
  const allReady = aReady && bReady;
  const okA = !aReady || rawA! <= balanceA.balance!;
  const okB = !bReady || rawB! <= balanceB.balance!;
  const canPreview = hasAmount && allReady && !buildOrder.isPending;

  // Per-field, not a single bottom-of-modal message -- each field owns the
  // message about its own asset (see AmountField's error prop below).
  // Independent checks, not an else-if: if both fields are genuinely over
  // balance, both should say so rather than hiding B's problem behind A's.
  const blockReasonA = hasAmount && allReady && !okA ? `Insufficient ${labelA} balance.` : null;
  const blockReasonB = hasAmount && allReady && !okB ? `Insufficient ${labelB} balance.` : null;

  // The build-failure message, routed by which asset the error actually
  // names, not by an assumption about pool composition -- confirmed (live
  // testing) that "any insufficient-funds error is about ADA" doesn't hold:
  // a stale client-side balance check could in principle let a genuinely
  // non-ADA shortfall reach a real build. `err.asset` matching neither pool
  // asset means the shortfall is ADA reserved outside the deposit itself
  // (fees/change in a token/token pool) -- no field to attach it to, so it
  // renders at the bottom instead.
  //
  // Two distinct shapes from the server (build-deposit/route.ts), not one:
  // `lastTriedAmount` means its internal retry loop ran out of rounds (or
  // hit the floor) for a matched pool asset -- confirmed live that one
  // correction isn't always enough (fixing a "change" shortfall by
  // reducing the amount can trigger a *different* "change_split" shortfall
  // once coin selection picks a new shape for the smaller amount). onError
  // above already auto-fills the field with this exact amount (not claimed
  // safe, just the lowest one actually reached) so the next Preview click
  // starts from a better position instead of reproducing the same failing
  // rounds -- this message just explains what happened and that it isn't
  // confirmed to work.
  // `missingQty` (no `lastTriedAmount`) means the unmatched, ADA-outside-
  // the-pool case, where there's no retry lever to pull in the first place.
  let buildErrorA: string | null = null;
  let buildErrorB: string | null = null;
  let buildErrorBottom: string | null = null;
  let buildErrorFallback: string | null = null;
  if (buildOrder.isError) {
    const err = buildOrder.error as BuildError;
    const isA = err.asset !== undefined && err.asset === assetA;
    const isB = err.asset !== undefined && err.asset === assetB;

    if (err.lastTriedAmount !== undefined && (isA || isB)) {
      const decimals = isA ? decimalsA.decimals : decimalsB.decimals;
      const label = isA ? labelA : labelB;
      if (decimals !== undefined && label !== undefined) {
        const message = `Adjusted to the lowest amount tried automatically: ${formatTokenAmountForInput(err.lastTriedAmount, decimals)} ${label}. Not confirmed to work yet — click Preview again to keep searching, or enter a different amount.`;
        if (isA) buildErrorA = message;
        else buildErrorB = message;
      }
    } else if (err.missingQty !== undefined && !isA && !isB) {
      // Verified exact, not estimated (live testing: topping up by
      // missingQty - 1 still fails with a recomputed shortfall of
      // exactly 1; topping up by missingQty exactly succeeds) -- but
      // only for the wallet's state right now. The buffer language is
      // an honest caveat about staleness, not an admission the number
      // itself is soft.
      buildErrorBottom = `Not enough ADA in wallet to complete this transaction — ~${formatTokenAmountForInput(err.missingQty, 6)} ADA needed (adding a bit more as a buffer is recommended).`;
    }

    if (buildErrorA === null && buildErrorB === null && buildErrorBottom === null) {
      buildErrorFallback = err.message;
    }
  }

  const maxFillA = computeMaxFill(decimalsA.decimals, balanceA.balance, learnedMax[assetA]);
  const maxFillB = computeMaxFill(decimalsB.decimals, balanceB.balance, learnedMax[assetB]);

  // One button, one position (bottom-left of the footer), two different
  // jobs depending on step -- Input refreshes the data a decision is made
  // from (balance, LP estimate); Review re-runs the real build (the
  // existing quote-refresh action, previously a button buried in the
  // Network fee row -- consolidated here instead of having two different
  // refresh affordances in two different places).
  const isRefreshing = step === "input" ? balanceA.isFetching || poolStateFetching : buildOrder.isPending;
  function handleRefresh() {
    if (step === "review") {
      buildOrder.mutate();
    } else {
      balanceA.refetch();
      refetchPoolState();
    }
  }

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
                error={blockReasonA ?? buildErrorA}
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
                error={blockReasonB ?? buildErrorB}
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

            {buildErrorBottom && <p className="text-xs text-destructive">{buildErrorBottom}</p>}
            {buildErrorFallback && <p className="text-xs text-destructive">{buildErrorFallback}</p>}
          </div>
        ) : (
          <ReviewStep
            labelA={labelA}
            labelB={labelB}
            rawA={rawA ?? 0n}
            rawB={rawB ?? 0n}
            decimalsA={decimalsA.decimals ?? 0}
            decimalsB={decimalsB.decimals ?? 0}
            requestedAmountA={buildOrder.data?.requestedAmountA}
            requestedAmountB={buildOrder.data?.requestedAmountB}
            adjustedAmountA={buildOrder.data?.adjustedAmountA}
            adjustedAmountB={buildOrder.data?.adjustedAmountB}
            platformCosts={platformCosts}
            lpQuote={lpQuote}
            slippage={slippage}
            fee={buildOrder.data?.fee}
            feeLoading={buildOrder.isPending}
            feeError={buildOrder.isError ? ((buildOrder.error as BuildError).message ?? null) : null}
            isExpired={isExpired}
            secondsRemaining={secondsRemaining}
          />
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={isRefreshing} onClick={handleRefresh}>
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {step === "review" && (
              <Button type="button" variant="outline" onClick={() => setStep("input")}>
                Back
              </Button>
            )}
          </div>
          {step === "input" ? (
            <Button disabled={!canPreview} onClick={() => buildOrder.mutate()}>
              {buildOrder.isPending ? "Building…" : "Preview"}
            </Button>
          ) : (
            // TODO: build + sign the real transaction -- no tx execution
            // yet, see docs/workflows/zap-in.md
            <Button disabled title="Not implemented yet">
              Confirm &amp; Sign
            </Button>
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
  requestedAmountA,
  requestedAmountB,
  adjustedAmountA,
  adjustedAmountB,
  platformCosts,
  lpQuote,
  slippage,
  fee,
  feeLoading,
  feeError,
  isExpired,
  secondsRemaining,
}: {
  labelA: string;
  labelB: string;
  rawA: bigint;
  rawB: bigint;
  decimalsA: number;
  decimalsB: number;
  // Both undefined until a build has actually succeeded at least once --
  // Review only ever renders after that, but buildOrder.data can still
  // reflect a previous attempt while a Refresh-triggered rebuild is
  // in flight (feeLoading), which is fine -- same pattern `fee` already
  // uses below.
  requestedAmountA: bigint | undefined;
  requestedAmountB: bigint | undefined;
  adjustedAmountA: bigint | undefined;
  adjustedAmountB: bigint | undefined;
  platformCosts: { amount: bigint; description: string; refundable: boolean }[];
  lpQuote: bigint | undefined;
  slippage: number;
  fee: bigint | undefined;
  feeLoading: boolean;
  feeError: string | null;
  isExpired: boolean;
  secondsRemaining: number | null;
}) {
  const slippageBps = BigInt(Math.round(slippage * 100));
  const minimumLpOut = lpQuote === undefined ? undefined : lpQuote - (lpQuote * slippageBps) / 10000n;

  // The server's retry loop (build-deposit/route.ts) may have reduced one
  // of the requested amounts to find a combination that actually builds --
  // this is the one place that gets disclosed, not silent (the input
  // fields get synced to match, but that alone isn't visible enough on its
  // own -- confirmed the hard way, this exact gap shipped once already).
  // Compared within the same build result, not against the (separately
  // synced) input fields, so this can't drift out of sync with what it's
  // describing.
  const adjustedA =
    requestedAmountA !== undefined && adjustedAmountA !== undefined && requestedAmountA !== adjustedAmountA;
  const adjustedB =
    requestedAmountB !== undefined && adjustedAmountB !== undefined && requestedAmountB !== adjustedAmountB;

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
        {adjustedA && (
          <p className="text-xs text-muted-foreground">
            {labelA} amount adjusted to fit: {formatTokenAmountForInput(requestedAmountA!, decimalsA)} →{" "}
            {formatTokenAmountForInput(adjustedAmountA!, decimalsA)}
          </p>
        )}
        {adjustedB && (
          <p className="text-xs text-muted-foreground">
            {labelB} amount adjusted to fit: {formatTokenAmountForInput(requestedAmountB!, decimalsB)} →{" "}
            {formatTokenAmountForInput(adjustedAmountB!, decimalsB)}
          </p>
        )}
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

      <CostBreakdown
        platformCosts={platformCosts}
        extra={
          <>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Network fee</span>
              {feeError ? (
                <span className="text-destructive">Err</span>
              ) : feeLoading ? (
                <Skeleton className="inline-block h-3 w-16 align-middle" />
              ) : isExpired ? (
                <span>Expired</span>
              ) : fee !== undefined ? (
                <span className="text-foreground">
                  {formatTokenAmountForInput(fee, 6)} ADA
                  {secondsRemaining !== null && (
                    <span className="ml-1 text-xs text-muted-foreground">({secondsRemaining}s)</span>
                  )}
                </span>
              ) : (
                "—"
              )}
            </div>
            {feeError && <p className="text-xs text-destructive">{feeError}</p>}
            {(feeError || isExpired) && (
              <p className="text-xs text-muted-foreground">Use Refresh below to try again.</p>
            )}
          </>
        }
      />
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
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onMax?: () => void;
  decimals: number | undefined;
  balance: bigint | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: string | null;
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
      {error && <p className="px-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
