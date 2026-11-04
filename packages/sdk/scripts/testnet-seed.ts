/// Opening activity on testnet, signed by the one deployer wallet: collateral in the vault, perps across the four
/// asset classes, a resting limit order, a call and a put on signed quotes, and a stock-backed loan with liquidity
/// in the pair. Safe to re-run: each run adds positions, nothing is closed.
///
///   PRIVATE_KEY=0x... RPC_URL=... API_URL=http://... pnpm --filter @zeno/sdk exec tsx scripts/testnet-seed.ts
import { createWalletClient, http, parseAbi, parseUnits, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAddresses, resolveChainId } from "@zeno/config";
import { Zeno } from "../src/index.js";

const key = process.env.PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.RPC_URL;
const apiUrl = process.env.API_URL;
if (!key || !rpcUrl || !apiUrl) throw new Error("Set PRIVATE_KEY, RPC_URL and API_URL.");

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const account = privateKeyToAccount(key);
const zeno = new Zeno({ chainId, transport: http(rpcUrl), account, addresses, apiUrl });
const wallet = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
const token = addresses.settlementToken as Address;
const erc20 = parseAbi(["function mint(address to, uint256 amount)", "function transfer(address to, uint256 amount) returns (bool)", "function decimals() view returns (uint8)", "function approve(address, uint256) returns (bool)"]);
const log = (message: string) => console.log(`- ${message}`);

async function send(address: Address, functionName: "mint" | "transfer" | "approve", args: readonly [Address, bigint]) {
  const hash = await wallet.writeContract({ address, abi: erc20, chain: null, functionName, args });
  await wallet.waitForTransactionReceipt({ hash });
}

/// Runs one step; a failure is logged and the seed moves on, so one refused trade does not stop the rest.
async function attempt(label: string, action: () => Promise<string>) {
  try {
    log(`${label}: ${await action()}`);
  } catch (error) {
    log(`${label}: skipped (${(error as { shortMessage?: string; message?: string }).shortMessage ?? (error as Error).message.split("\n")[0]})`);
  }
}

const usdg = await wallet.readContract({ address: token, abi: erc20, functionName: "decimals" });
/// ONLY=lending runs the loan step alone (after a first run whose loan was refused).
const trading = process.env.ONLY !== "lending";
if (trading) {
for (let i = 0; i < 6; i++) await send(token, "mint", [account.address, parseUnits("10000", usdg)]);
await zeno.erc20.approve(token, addresses.vault, "40000", { wait: true });
await zeno.vault.deposit(token, "40000", { wait: true });
log("minted 60,000 USDG, deposited 40,000 in the vault");

const perps: Array<[string, "LONG" | "SHORT", string, number]> = [
  ["BTC", "LONG", "2000", 3],
  ["ETH", "SHORT", "1500", 2],
  ["NVDA", "LONG", "1200", 5],
  ["SPY", "LONG", "1500", 10],
  ["GLD", "LONG", "900", 3],
  ["TSLA", "SHORT", "1000", 2],
  ["AAPL", "LONG", "800", 3],
  ["SLV", "LONG", "600", 2],
  ["QQQ", "SHORT", "1000", 4],
];
for (const [market, side, collateral, leverage] of perps) {
  await attempt(`${side.toLowerCase()} ${market} ${leverage}x on $${collateral}`, async () => {
    const opened = await zeno.perps.openPosition({ market, side, collateral, leverage, tx: { wait: true } });
    return `position #${opened.positionId}`;
  });
}

await attempt("limit order: long ETH 5% under the mark", async () => {
  const mark = (await zeno.oracle.getMarkPrice("ETH")).price;
  const limit = ((mark * 95n) / 100n / 10n ** 16n).toString();
  const { orderId } = await zeno.perps.placeLimitOrder({ market: "ETH", side: "LONG", collateral: "500", leverage: 2, limitPrice: `${limit.slice(0, -2)}.${limit.slice(-2)}`, tx: { wait: true } });
  return `order #${orderId}`;
});

/// Option expiries match the ones the site proposes: whole days ahead, settling at 20:00 UTC.
function expiryIn(days: number): bigint {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(20, 0, 0, 0);
  return BigInt(Math.floor(at.getTime() / 1000));
}
for (const [underlying, type, moneyness, days] of [["NVDA", "CALL", 1.05, 7], ["BTC", "PUT", 0.95, 14], ["SPY", "CALL", 1.02, 7]] as const) {
  await attempt(`${type.toLowerCase()} on ${underlying}`, async () => {
    const mark = Number((await zeno.oracle.getMarkPrice(underlying)).price / 10n ** 16n) / 100;
    const strike = String(Math.round(mark * moneyness));
    const series = { underlying, type, strike, expiry: expiryIn(days), contracts: 1 } as const;
    const preview = await zeno.options.previewOpen({ ...series, user: account.address });
    if (!preview.authorization) throw new Error("no signed quote");
    const opened = await zeno.options.openPosition({ ...series, authorization: preview.authorization, tx: { wait: true } });
    return `position #${opened.positionId}, strike ${strike}, premium ${preview.premium}`;
  });
}

}

const pair = addresses.creditPairTslaUsdg as Address | undefined;
if (pair) {
  await attempt("lending: liquidity, 5 TSLA collateral, borrow 600 USDG", async () => {
    const market = await zeno.credit.market(pair);
    const collateral = market.collateralToken as Address;
    const cDecimals = await wallet.readContract({ address: collateral, abi: erc20, functionName: "decimals" });
    await send(token, "transfer", [pair, parseUnits("15000", usdg)]);
    await send(collateral, "mint", [account.address, parseUnits("10", cDecimals)]);
    await send(collateral, "approve", [pair, parseUnits("5", cDecimals)]);
    await zeno.credit.depositCollateral(pair, parseUnits("5", cDecimals), { wait: true });
    await zeno.credit.borrow(pair, parseUnits("600", usdg), { wait: true });
    const position = await zeno.credit.position(pair, account.address);
    return `health ${(Number(position.healthFactorBps) / 10_000).toFixed(2)}x`;
  });
}
console.log("done");
