import { isReleased, releaseFor, requireEnv, resolveChainId, ROBINHOOD_TESTNET_CHAIN_ID } from "@zeno/config";
import { Zeno } from "@zeno/sdk";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { createPublicClient, http, type PublicClient } from "viem";
import { registerCors } from "./cors.js";
import { resolveCreditPair } from "./credit.js";
import { registerAiRoutes } from "./routes/ai.js";
import { registerCopyRoutes } from "./routes/copy.js";
import { registerCreditRoutes } from "./routes/credit.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerAdvancedRoutes } from "./routes/advanced.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerLeaderboardRoutes } from "./routes/leaderboard.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerOptionRoutes } from "./routes/options.js";
import { registerPerpRoutes } from "./routes/perps.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerQuotedRoutes } from "./routes/quoted.js";
import { registerPriceRoutes } from "./routes/prices.js";
import { registerRfqRoutes } from "./routes/rfq.js";
import { httpUpstream, registerRpcProxy } from "./rpcProxy.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerTradeRoutes } from "./routes/trade.js";
import { registerWebSocket } from "./ws.js";

export function buildServer() {
  const chainId = resolveChainId(process.env.CHAIN_ID);
  const rpcUrl = requireEnv("RPC_URL");
  const zeno = new Zeno({ chainId, transport: http(rpcUrl) });
  // Routes for a feature from a later release are not served until this network runs it (`RELEASE`, mainnet only).
  const release = releaseFor(chainId, process.env.RELEASE);

  const app = Fastify({ logger: true });

  registerCors(app);
  app.register(websocket);
  app.get("/health", async () => ({ ok: true }));

  app.register(async (instance) => {
    registerRpcProxy(instance, httpUpstream(rpcUrl));
    registerMarketRoutes(instance, zeno);
    registerOptionRoutes(instance, zeno);
    registerPerpRoutes(instance, zeno);
    registerPriceRoutes(instance, zeno);
    registerPortfolioRoutes(instance, zeno);
    registerQuotedRoutes(instance);
    registerStatsRoutes(instance);
    registerAnalyticsRoutes(instance);
    registerAdvancedRoutes(instance, zeno);
    registerAlertRoutes(instance);
    registerLeaderboardRoutes(instance, zeno);
    if (isReleased("copyTrading", release)) registerCopyRoutes(instance, zeno);
    if (isReleased("lending", release)) registerCreditRoutes(instance, createPublicClient({ transport: http(rpcUrl) }), resolveCreditPair(zeno.addresses, process.env.CREDIT_PAIR_ADDRESS));
    registerTradeRoutes(instance, zeno);
    // Ask Zeno runs on mainnet only, so the free model quota serves mainnet users (testnet answers "not switched on").
    // AI_ON_TESTNET=true turns it on for a testnet API on this machine (scripts/ai-local.sh).
    registerAiRoutes(instance, chainId === ROBINHOOD_TESTNET_CHAIN_ID && process.env.AI_ON_TESTNET !== "true" ? { llm: null } : {});
    if (isReleased("rfq", release)) registerRfqRoutes(instance, zeno);
    registerWebSocket(instance, zeno);
  });

  return app;
}
