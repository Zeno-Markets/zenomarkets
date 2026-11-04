/// Rewrites the checked-in `<network>Markets` literal in `src/markets.ts` from
/// `packages/contracts/deployments/<network>.markets.json`, which is the source of the market list,
/// its groups and its tiers. Same arrangement as `sync-deployments.ts`: the JSON is the data, the
/// literal is generated, and `markets.test.ts` fails if the two drift.
///
/// Usage: `pnpm --filter @zeno/config sync:markets [network]` (default `robinhood_mainnet`).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isListingTier, isMarketGroup, tierNeedsFeed } from "@zeno/types";

const network = process.argv[2] ?? "robinhood_mainnet";
const jsonPath = resolve(import.meta.dirname, `../../contracts/deployments/${network}.markets.json`);
const sourcePath = resolve(import.meta.dirname, "../src/markets.ts");

// `robinhood_mainnet` -> `robinhoodMainnetMarkets`.
const constName = `${network.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}Markets`;
const literal = new RegExp(`(const ${constName}: readonly MarketListing\\[\\] = \\[\\n)([\\s\\S]*?)(\\n\\];)`);

const source = readFileSync(sourcePath, "utf8");
if (!literal.test(source)) throw new Error(`sync-markets: ${constName} literal not found in ${sourcePath}`);

interface Row {
  symbol: string;
  name: string;
  token?: string;
  feed?: string;
  maxLeverage: number;
  maintenanceBps: number;
  group: string;
  tier: string;
  logo?: string;
  historySymbol?: string;
}

const file = JSON.parse(readFileSync(jsonPath, "utf8")) as { chainId: number; markets: Row[] };
const isAddress = (value: unknown) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);

for (const row of file.markets) {
  const where = `${jsonPath} ${row.symbol ?? "(no symbol)"}`;
  if (typeof row.symbol !== "string" || row.symbol === "") throw new Error(`sync-markets: ${where} has no symbol`);
  if (typeof row.name !== "string" || row.name === "") throw new Error(`sync-markets: ${where} has no name`);
  // A display-only row for a stock with no token on this chain has none; a tradeable one always has.
  if (row.token === undefined ? tierNeedsFeed(row.tier) : !isAddress(row.token)) throw new Error(`sync-markets: ${where} token is missing or not an address`);
  if (!Number.isInteger(row.maxLeverage) || row.maxLeverage < 1) throw new Error(`sync-markets: ${where} maxLeverage is not a positive integer`);
  if (!Number.isInteger(row.maintenanceBps) || row.maintenanceBps < 1) throw new Error(`sync-markets: ${where} maintenanceBps is not a positive integer`);
  if (!isMarketGroup(row.group)) throw new Error(`sync-markets: ${where} has unknown group "${row.group}"`);
  if (!isListingTier(row.tier)) throw new Error(`sync-markets: ${where} has unknown tier "${row.tier}"`);
  // The tier boundary is enforced here too, so a bad row never even reaches the generated literal.
  if (tierNeedsFeed(row.tier) && !isAddress(row.feed)) throw new Error(`sync-markets: ${where} is tier "${row.tier}" and needs a feed address`);
  if (!tierNeedsFeed(row.tier) && row.feed !== undefined) throw new Error(`sync-markets: ${where} is tier "${row.tier}" and must have no feed`);
}

const body = file.markets
  .map((row) => {
    const fields = [
      `symbol: ${JSON.stringify(row.symbol)}`,
      `name: ${JSON.stringify(row.name)}`,
      ...(row.token ? [`token: ${JSON.stringify(row.token)}`] : []),
      ...(row.feed ? [`feed: ${JSON.stringify(row.feed)}`] : []),
      `maxLeverage: ${row.maxLeverage}`,
      `maintenanceBps: ${row.maintenanceBps}`,
      `group: ${JSON.stringify(row.group)}`,
      `tier: ${JSON.stringify(row.tier)}`,
      ...(row.logo ? [`logo: ${JSON.stringify(row.logo)}`] : []),
      ...(row.historySymbol ? [`historySymbol: ${JSON.stringify(row.historySymbol)}`] : []),
    ];
    return `  { ${fields.join(", ")} },`;
  })
  .join("\n");

writeFileSync(sourcePath, source.replace(literal, `$1${body}$3`));
console.log(`Updated ${file.markets.length} markets in src/markets.ts from deployments/${network}.markets.json`);
