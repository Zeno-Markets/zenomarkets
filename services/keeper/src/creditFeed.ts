import { parseAbi, type Account, type Address, type PublicClient, type WalletClient } from "viem";

const oracleAbi = parseAbi([
  "function prices(address asset) view returns (uint256 price, uint256 lastUpdated)",
  "function maxDeviationBps() view returns (uint256)",
  "function setPrice(address asset, uint256 price)",
  "function forcePrice(address asset, uint256 price)",
]);
const pairAbi = parseAbi(["function collateralToken() view returns (address)", "function debtToken() view returns (address)"]);
/// The loan is in USDG, a dollar stablecoin: the oracle holds it at $1, refreshed well inside its staleness window.
const DOLLAR = 10n ** 18n;
const DEBT_REFRESH_SECONDS = 12n * 3600n;
/// The router's primary source is `ZenoChainlinkFeedAdapter`, not the aggregator: it answers `latestPrice` and `decimals`.
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestPrice() view returns (uint256 price, uint256 updatedAt)",
]);
const routerAbi = parseAbi(["function primarySource(bytes32 marketId) view returns (address)"]);

/// True when `next` is further from `stored` than the oracle's per-update limit allows, so `setPrice` would revert.
export function exceedsDeviation(stored: bigint, next: bigint, maxBps: bigint): boolean {
  if (stored === 0n) return false;
  return ((next > stored ? next - stored : stored - next) * 10_000n) / stored > maxBps;
}

export interface CreditFeedDeps {
  publicClient: PublicClient;
  walletClient: WalletClient;
  oracleRouter: Address;
  creditOracle: Address;
  creditPair: Address;
  /// The market id (32 bytes) whose Chainlink feed prices the collateral, e.g. TSLA.
  collateralMarketId: `0x${string}`;
  log?: (message: string) => void;
}

/// Copies the collateral's Chainlink price into the credit oracle, which has no feed of its own. Skips while the
/// feed's answer is not newer than the oracle's price (the equity session is shut): the stored price then stays the
/// last close, and the oracle's own staleness limit (4 days on mainnet) decides when borrowing stops. The owner is the oracle's feeder.
export function createCreditFeed(deps: CreditFeedDeps) {
  const { publicClient, walletClient, creditOracle } = deps;
  const account: Account = walletClient.account!;
  const log = deps.log ?? ((message: string) => console.log(`keeper: ${message}`));

  async function pushDebtPrice(): Promise<void> {
    const debt = await publicClient.readContract({ address: deps.creditPair, abi: pairAbi, functionName: "debtToken" });
    const [price, lastUpdated] = await publicClient.readContract({ address: creditOracle, abi: oracleAbi, functionName: "prices", args: [debt] });
    const now = (await publicClient.getBlock()).timestamp;
    if (price === DOLLAR && now - lastUpdated < DEBT_REFRESH_SECONDS) return;
    const { request } = await publicClient.simulateContract({ address: creditOracle, abi: oracleAbi, functionName: price === 0n || price === DOLLAR ? "setPrice" : "forcePrice", args: [debt, DOLLAR], account });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    log(`credit oracle price 1.00 for the debt token ${debt} (${hash})`);
  }

  return async function pushCreditPrice(): Promise<boolean> {
    await pushDebtPrice();
    const [collateral, feed] = await Promise.all([
      publicClient.readContract({ address: deps.creditPair, abi: pairAbi, functionName: "collateralToken" }),
      publicClient.readContract({ address: deps.oracleRouter, abi: routerAbi, functionName: "primarySource", args: [deps.collateralMarketId] }),
    ]);
    const [decimals, [answer, updatedAt]] = await Promise.all([
      publicClient.readContract({ address: feed, abi: feedAbi, functionName: "decimals" }),
      publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestPrice" }),
    ]);
    if (answer <= 0n) return false;
    const next = answer * 10n ** BigInt(18 - decimals);
    const [price, lastUpdated] = await publicClient.readContract({ address: creditOracle, abi: oracleAbi, functionName: "prices", args: [collateral] });
    // The feed has not printed since the oracle was last written: pushing it again would only reset the stale clock.
    if (updatedAt <= lastUpdated && price !== 0n) return false;
    if (next === price) return false;

    const maxBps = await publicClient.readContract({ address: creditOracle, abi: oracleAbi, functionName: "maxDeviationBps" });
    // A gap at the open can pass the per-update limit; the owner may force the price.
    const functionName = exceedsDeviation(price, next, maxBps) ? "forcePrice" : "setPrice";
    const { request } = await publicClient.simulateContract({ address: creditOracle, abi: oracleAbi, functionName, args: [collateral, next], account });
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    log(`credit oracle price ${next} for ${collateral} (${functionName}, ${hash})`);
    return true;
  };
}
