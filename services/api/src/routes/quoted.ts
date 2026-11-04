import type { FastifyInstance } from "fastify";
import { quotedRows } from "../quoted.js";

/// Display-only rows: price, source and age, and nothing to trade. See `../quoted.ts`.
export function registerQuotedRoutes(app: FastifyInstance) {
  app.get("/v1/quoted", async () => quotedRows());
}
