"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet/wallet-context";
import { WalletPickerDialog } from "@/components/wallet/wallet-picker-dialog";
import { connectWallet } from "@/components/wallet/cip30";
import { getRememberedWallet } from "@/components/wallet/storage";
import { formatAddress } from "@/lib/format";

export function ConnectWalletButton() {
  const {
    status,
    address,
    walletIcon,
    network,
    beginConnecting,
    finishConnecting,
    disconnect,
  } = useWallet();
  const [open, setOpen] = useState(false);

  // Silent reconnect: only ever retries the one wallet we already connected
  // before (remembered by key, not by blindly probing every installed
  // wallet), so this never surprises the user with an approval prompt for a
  // wallet they haven't already granted — `enable()` on that specific wallet
  // resolves without a popup, same as it did on the manual reconnect.
  useEffect(() => {
    const rememberedKey = getRememberedWallet();
    if (!rememberedKey) return;

    let cancelled = false;
    beginConnecting();

    connectWallet(rememberedKey)
      .then((result) => {
        if (!cancelled) finishConnecting(result);
      })
      .catch(() => {
        if (!cancelled) disconnect();
      });

    return () => {
      cancelled = true;
    };
  }, [beginConnecting, finishConnecting, disconnect]);

  if (status === "connected" && address) {
    return (
      <div className="flex items-center gap-2">
        {walletIcon && (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary data: URI icon from the connected third-party wallet extension
          <img
            src={walletIcon}
            alt=""
            width={20}
            height={20}
            className="rounded-full"
          />
        )}
        <span className="text-sm">{formatAddress(address)}</span>
        <span className="text-xs text-muted-foreground">
          {network === "mainnet" ? "Mainnet" : "Testnet"}
        </span>
        <Button variant="outline" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={status === "connecting"}
        onClick={() => setOpen(true)}
      >
        {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </Button>
      <WalletPickerDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
