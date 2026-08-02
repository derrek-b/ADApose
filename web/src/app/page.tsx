import { PoolTable } from "@/components/pool-table";
import { getPoolRows } from "@/lib/pool-data-adapter";

// current_readings only changes when the refresh scripts run (manually, for
// now) -- re-query on every request rather than let Next statically cache
// a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function Home() {
  const pools = await getPoolRows();
  return (
    <main className="flex flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-5xl">
        <h2 className="mb-4 text-center text-xl font-semibold tracking-tight">
          Pools
        </h2>
        <PoolTable pools={pools} />
      </div>
    </main>
  );
}
