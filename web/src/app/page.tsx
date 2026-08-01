import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-16">
      <h1 className="text-2xl font-semibold tracking-tight">ADApose</h1>
      <p className="max-w-md text-center text-muted-foreground">
        Cross-DEX liquidity position discovery — pool comparison table goes
        here (D28/D29, docs/decisions.md).
      </p>
      <Button>shadcn/ui wired up</Button>
    </main>
  );
}
