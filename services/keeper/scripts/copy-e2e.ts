/// Runs the copy trading acceptance checks (docs/DEVELOPMENT_PHASES.md Phase 18) on the live testnet, with two fresh
/// throwaway wallets (a leader and a follower) and the deployer as the executor. Prints one line per check with the
/// transaction hashes. Needs a database that has the indexer's schema (a scratch one: the copy tables are emptied).
///
///   (set -a; . ./.env.testnet; set +a; DATABASE_URL=postgres://... RPC_URL=... pnpm --filter @zeno/keeper copy:e2e)
import { resolveAddresses, resolveChainId } from "@zeno/config";
import { Zeno } from "@zeno/sdk";
import postgres from "postgres";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createCopyExecutor } from "../src/copy.js";

const rpc = process.env.RPC_URL!;
const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const deployer = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
const transport = http(rpc);
const zenoFor = (account: ReturnType<typeof privateKeyToAccount>) => new Zeno({ chainId, transport, account, addresses });
const chain = zenoFor(deployer);
const wallet = createWalletClient({ account: deployer, transport });
const reader = createPublicClient({ transport });
const sql = postgres(process.env.DATABASE_URL!);
const token = addresses.settlementToken as Address;
const wait = { wait: true } as const;
const MARKET = "NVDA";
const results: string[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push(`${ok ? "pass" : "FAIL"} | ${name} | ${detail}`);
  console.log(results.at(-1));
};

const send = async (to: Address, value: bigint) => {
  const hash = await wallet.sendTransaction({ to, value, chain: null });
  await reader.waitForTransactionReceipt({ hash });
};
const mint = async (to: Address, amount: string) => {
  const hash = await wallet.writeContract({ address: token, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [to, parseEther(amount)], chain: null });
  await reader.waitForTransactionReceipt({ hash });
};

const leaderAccount = privateKeyToAccount(generatePrivateKey());
const followerAccount = privateKeyToAccount(generatePrivateKey());
const leader = zenoFor(leaderAccount);
const follower = zenoFor(followerAccount);
console.log(`leader ${leaderAccount.address}\nfollower ${followerAccount.address}\nexecutor ${deployer.address}`);

// Setup: gas, collateral, the leader's vault balance, the follower's copy account with the executor as delegate.
await send(leaderAccount.address, parseEther("0.00015"));
await send(followerAccount.address, parseEther("0.00015"));
await mint(leaderAccount.address, "2000");
await mint(followerAccount.address, "1000");
await leader.erc20.approve(token, addresses.vault, "1000", wait);
await leader.vault.deposit(token, "1000", wait);
const created = await follower.subaccounts.create(0n, wait);
await follower.subaccounts.deposit(created.address, "500", { tx: wait });
await follower.subaccounts.setDelegate(created.address, deployer.address, true, wait);
// Fresh mock price, so no stale feed gets in the way of the checks.
const feed = await reader.readContract({ address: addresses.oracleRouter as Address, abi: parseAbi(["function primarySource(bytes32) view returns (address)"]), functionName: "primarySource", args: [`0x${Buffer.from(MARKET).toString("hex").padEnd(64, "0")}`] });
const [price] = await reader.readContract({ address: feed, abi: parseAbi(["function latestPrice() view returns (uint256,uint256)"]), functionName: "latestPrice" });
await reader.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: feed, abi: parseAbi(["function setPrice(uint256)"]), functionName: "setPrice", args: [price], chain: null }) });

await sql`truncate copy_follows, copy_executions restart identity`;
const [{ id }] = await sql`
  insert into copy_follows (follower, leader, subaccount, max_trade_size, max_exposure, max_leverage, markets, active, issued_at)
  values (${followerAccount.address.toLowerCase()}, ${leaderAccount.address.toLowerCase()}, ${created.address.toLowerCase()}, ${parseEther("400").toString()}, ${parseEther("600").toString()}, 3, null, true, 1) returning id`;
const executor = createCopyExecutor({ zeno: chain, publicClient: reader, sql, executor: deployer.address, log: (m) => console.log("  " + m) });
const followerPositions = async () => (await follower.portfolio.positions(created.address)).perps;

// 1. A leader long is mirrored, in proportion.
const t0 = Date.now();
const block0 = await reader.getBlockNumber();
const first = await leader.perps.openPosition({ market: MARKET, side: "LONG", collateral: "100", leverage: 2, tx: wait });
const counts1 = await executor.tick();
const mirrored = (await followerPositions()).find((p) => p.open);
const block1 = await reader.getBlockNumber();
const [e1] = await sql`select open_tx from copy_executions where status = 'open'`;
check(
  "leader long mirrored proportionally",
  counts1.opened === 1 && mirrored !== undefined && Math.abs(Number(mirrored.collateral) / 1e18 - 50) < 0.05 && mirrored.isLong && mirrored.leverage === 2n,
  `leader #${first.positionId} 100 x2 of 1,000 -> follower #${mirrored?.positionId} ${mirrored ? (Number(mirrored.collateral) / 1e18).toFixed(2) : "?"} x${mirrored?.leverage} of 500; tx ${e1?.open_tx}; ${Date.now() - t0} ms and ${block1 - block0} blocks from the leader's open to the mirror`,
);

// 2. A follower over a cap records a skip and opens nothing.
const risky = await leader.perps.openPosition({ market: MARKET, side: "SHORT", collateral: "100", leverage: 5, tx: wait });
const before = (await followerPositions()).length;
const counts2 = await executor.tick();
const [skip] = await sql`select status, reason from copy_executions where leader_position_id = ${risky.positionId.toString()}`;
check("follower over cap: skip recorded, nothing opened", counts2.skipped === 1 && skip?.status === "skipped" && (await followerPositions()).length === before, `leader #${risky.positionId} 5x vs the follower's 3x limit; reason "${skip?.reason}"`);

// 3. A leader close is mirrored.
await leader.perps.closePosition(first.positionId, { tx: wait });
const counts3 = await executor.tick();
const closed = (await followerPositions()).find((p) => p.positionId === mirrored?.positionId);
const [e3] = await sql`select close_tx from copy_executions where status = 'closed'`;
check("leader close mirrored", counts3.closed === 1 && closed?.open === false, `follower #${mirrored?.positionId} closed; tx ${e3?.close_tx}`);

// 4. Unfollow stops mirroring at once.
await sql`update copy_follows set active = false where id = ${id}`;
const after = await leader.perps.openPosition({ market: MARKET, side: "LONG", collateral: "50", leverage: 2, tx: wait });
const counts4 = await executor.tick();
check("unfollow stops mirroring at once", counts4.opened === 0 && (await followerPositions()).filter((p) => p.open).length === 0, `leader opened #${after.positionId} after the stop; the follower copied nothing`);

// 5. The executor's key cannot take money out of the follower's copy account.
let refused = "";
try {
  await chain.subaccounts.withdraw(created.address, "1", { tx: wait });
} catch (error) {
  refused = (error as { errorName?: string; shortMessage?: string }).errorName ?? (error as { shortMessage?: string }).shortMessage ?? String(error);
}
check("executor key cannot withdraw", refused.length > 0, `withdraw as the executor reverted: ${refused}`);

// Tidy: the leader closes what is left.
await leader.perps.closePosition(risky.positionId, { tx: wait }).catch(() => {});
await leader.perps.closePosition(after.positionId, { tx: wait }).catch(() => {});
console.log("\n" + results.join("\n"));
await sql.end();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
