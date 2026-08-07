"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/components/wallet/wallet-context";

export function Providers({ children }: { children: React.ReactNode }) {
  // TanStack Query's own default is 3 -- tightened to 2. None of today's
  // queries (wallet balance, decimals, pool state) have a known "will
  // always fail no matter how many retries" mode worth a per-query
  // override; the one that does (building a deposit order -- insufficient
  // funds is genuinely non-retryable) sets its own retry predicate instead
  // of relying on this default.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2 } } }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WalletProvider>{children}</WalletProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
