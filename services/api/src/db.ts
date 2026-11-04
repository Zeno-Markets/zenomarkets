import { requireEnv } from "@zeno/config";
import postgres from "postgres";

/// Plain `postgres.js` client, not Drizzle — `services/api` only ever reads rows
/// `services/indexer` wrote (DEVELOPMENT_STEPS.md "Backend services": services share data
/// through the database, not through importing each other's schema/internals). Lazy so
/// `loadDotEnv()` in the entrypoint runs before `DATABASE_URL` is read.
let cached: ReturnType<typeof postgres> | undefined;

export function getSql() {
  if (!cached) {
    // `idle_timeout` closes idle connections after 20 s. An open pooled connection keeps the service
    // from sleeping under Railway Serverless (free-plan mode, docs/evidence/phase-T.md).
    cached = postgres(requireEnv("DATABASE_URL"), { transform: postgres.camel, idle_timeout: 20 });
  }
  return cached;
}
