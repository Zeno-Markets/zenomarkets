import { loadDotEnv } from "@zeno/config";
loadDotEnv();

import { requireEnv, resolveAddresses, resolveChainId, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { Zeno } from "@zeno/sdk";
import { createPublicClient, createWalletClient, http, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "@zeno/config";
import postgres from "postgres";
import { createCopyExecutor } from "./copy.js";
import { createCreditFeed } from "./creditFeed.js";
import { createKeeper } from "./keeper.js";
import { referencePrice } from "./reference.js";

const chainId = resolveChainId(process.env.CHAIN_ID);
const account = privateKeyToAccount(requireEnv("KEEPER_PRIVATE_KEY") as Hex);
const transport = http(requireEnv("RPC_URL"));

const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);
/// Half the oracle's default 1 hour staleness window, so one missed tick does not stall the market.
const refreshSeconds = BigInt(process.env.KEEPER_FEED_REFRESH_SECONDS ?? 1_800);
/// Free-plan mode: one pass, then exit, for a Railway cron service. Unset keeps the always-on loop.
const runOnce = process.env.KEEPER_RUN_ONCE === "true";
const refreshFeeds = (process.env.KEEPER_REFRESH_FEEDS ?? "true") !== "false";

const zeno = new Zeno({ chainId, transport, account, addresses: resolveAddresses(chainId) });
const keeper = createKeeper({
  zeno,
  publicClient: createPublicClient({ chain: chains[chainId], transport }),
  walletClient: createWalletClient({ account, chain: chains[chainId], transport }),
  refreshSeconds,
  refreshFeeds,
  // Testnet feeds follow the real market; KEEPER_FOLLOW_REFERENCE=false keeps them flat.
  referencePrice: chainId !== ROBINHOOD_MAINNET_CHAIN_ID && process.env.KEEPER_FOLLOW_REFERENCE !== "false" ? (id) => referencePrice(id) : undefined,
  minMoveBps: BigInt(process.env.KEEPER_MIN_MOVE_BPS ?? 25),
});

/// Copy trading: mirrors leaders into followers' copy subaccounts. On whenever the keeper has a database, because
/// the follows live there; the keeper's own account is the executor the follower authorises.
const copy = process.env.DATABASE_URL
  ? createCopyExecutor({
      zeno,
      publicClient: createPublicClient({ chain: chains[chainId], transport }),
      sql: postgres(process.env.DATABASE_URL, { idle_timeout: 20 }),
      executor: account.address,
      log: console.log,
    })
  : undefined;

/// `KEEPER_CREDIT_FEED=true`: the credit oracle has no feed of its own, so the keeper copies the collateral's
/// price from the oracle router into it (Chainlink on mainnet, the reference-following mock feed on testnet).
const addresses = resolveAddresses(chainId);
const creditFeed =
  process.env.KEEPER_CREDIT_FEED === "true" && addresses.creditOracle && addresses.creditPairTslaUsdg
    ? createCreditFeed({
        publicClient: createPublicClient({ chain: chains[chainId], transport }),
        walletClient: createWalletClient({ account, chain: chains[chainId], transport }),
        oracleRouter: addresses.oracleRouter,
        creditOracle: addresses.creditOracle,
        creditPair: addresses.creditPairTslaUsdg,
        collateralMarketId: stringToHex(process.env.KEEPER_CREDIT_MARKET ?? "TSLA", { size: 32 }),
      })
    : undefined;

console.log(`keeper: ${account.address} on chain ${chainId}, every ${intervalMs}ms (feed refresh ${refreshFeeds ? "on" : "off"}, copy trading ${copy ? "on" : "off"}, credit feed ${creditFeed ? "on" : "off"})`);
for (;;) {
  try {
    await keeper.tick();
  } catch (error) {
    console.error("keeper: tick failed", error);
  }
  try {
    await copy?.tick();
  } catch (error) {
    console.error("keeper: copy pass failed", error);
  }
  try {
    await creditFeed?.();
  } catch (error) {
    console.error("keeper: credit price feed failed", error);
  }
  if (runOnce) process.exit(0);
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
