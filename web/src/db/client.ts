import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// Next.js dev-mode HMR re-evaluates this module on every reload; without
// caching on globalThis each reload would open a new connection pool and
// leak the old one.
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const sql = globalForDb.sql ?? postgres(process.env.DATABASE_URL!);
if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;

export const db = drizzle(sql, { schema });
