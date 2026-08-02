"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-muted-foreground">
        Something went wrong loading pool data.
      </p>
      <Button variant="outline" onClick={() => reset()}>
        Try again
      </Button>
    </main>
  );
}
