"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/components/wallet/wallet-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WalletProvider>{children}</WalletProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
