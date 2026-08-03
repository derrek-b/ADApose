"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  discoverWallets,
  connectWallet,
  isUserCancellation,
  type CipWalletEntry,
} from "@/components/wallet/cip30";
import { useWallet } from "@/components/wallet/wallet-context";

export function WalletPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { beginConnecting, finishConnecting, disconnect } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const wallets: CipWalletEntry[] = open ? discoverWallets() : [];

  async function handlePick(entry: CipWalletEntry) {
    setError(null);
    beginConnecting();
    try {
      const result = await connectWallet(entry.key);
      finishConnecting(result);
      onOpenChange(false);
    } catch (err) {
      disconnect();
      if (!isUserCancellation(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
        </DialogHeader>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Cardano wallet extensions found.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {wallets.map((wallet) => (
              <li key={wallet.key}>
                <button
                  type="button"
                  onClick={() => handlePick(wallet)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary data: URI icons from third-party wallet extensions, not a static asset next/image can optimize */}
                  <img src={wallet.icon} alt="" width={24} height={24} />
                  {wallet.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
