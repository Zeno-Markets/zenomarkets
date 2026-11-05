import { env } from "@/lib/env";

/// What the products line names: lending and borrowing only once the build runs V2.0 (testnet runs every release).
export const PRODUCT_LINE = env.lending ? "Perps, options, lending and borrowing" : "Perps and options";

/// One title for every page, in the tab, the history and the share card. Pages do not set their own.
export const SITE_TITLE = "ZENOMARKETS: One view. A world of markets.";
export const SITE_DESCRIPTION = `Stocks, ETFs, crypto and commodities. ${PRODUCT_LINE} on Robinhood Chain.`;
