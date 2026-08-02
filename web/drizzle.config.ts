import { defineConfig } from "drizzle-kit";

// drizzle-kit runs as its own CLI process, outside Next's request lifecycle,
// so it never gets Next's automatic .env.local loading — load it explicitly.
process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
