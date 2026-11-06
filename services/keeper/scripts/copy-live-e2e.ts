// End-to-end proof of copy trading (V3.0) on the live testnet: the real contracts, the real API and the real keeper.
// Two fresh wallets: a leader trades from its own account, a follower funds a copy subaccount, makes the keeper
// its delegate and signs a follow. The leader opens; the keeper must open the copy. The leader closes; the keeper
// must close it. Then the follower stops the follow. Costs only testnet gas, paid by FUNDER_KEY.
//
//   FUNDER_KEY=0x... [API_URL=https://testnet.zenomarkets.tech] [MARKET=BTC] \
//     pnpm --filter @zeno/keeper copy:live-e2e
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ROBINHOOD_TESTNET_CHAIN_ID } from "@zeno/config";
import { Zeno, copyFollowMessage, copyUnfollowMessage } from "@zeno/sdk";

const RPC = process.env.RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const API = process.env.API_URL ?? "https://testnet.zenomarkets.tech";
const MARKET = process.env.MARKET ?? "BTC";
const funderKey = process.env.FUNDER_KEY as Hex | undefined;
if (!funderKey) throw new Error("FUNDER_KEY is required (a funded testnet key)");

const transport = http(RPC);
const chain = createPublicClient({ transport });
const funder = createWalletClient({ account: privateKeyToAccount(funderKey), transport });
const make = () => {
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, zeno: new Zeno({ chainId: ROBINHOOD_TESTNET_CHAIN_ID, transport, account, apiUrl: API }) };
};
const leader = make();
const follower = make();
const token = leader.zeno.addresses.settlementToken;
const wait = { wait: true } as const;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const api = async (path: string, body?: unknown) => {
  const response = await fetch(`${API}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, json: (await response.json()) as any };
};
/// The keeper ticks every 20 s; give it a few passes.
async function until<T>(what: string, read: () => Promise<T | undefined>, ms = 180_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read().catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.log(`      timed out waiting for ${what}`);
  return undefined;
}
const execution = (status: string) => async () => {
  const { json } = await api(`/v1/copy/follows?follower=${follower.account.address}`);
  return (json.executions as any[]).find((e) => e.status === status);
};

// ---- 0. The API serves V3.0 and names the executor ------------------------------------------------------------
const config = await api("/v1/copy/config");
const executor = config.json.executor as `0x${string}` | null;
check("/v1/copy/config answers 200 with an executor", config.status === 200 && Boolean(executor), JSON.stringify(config.json));
if (!executor) process.exit(1);

// ---- 1. Fund two fresh wallets: gas and settlement token -------------------------------------------------------
for (const w of [leader, follower]) {
  await chain.waitForTransactionReceipt({ hash: await funder.sendTransaction({ chain: null, to: w.account.address, value: parseEther("0.0005") }) });
  const mint = await createWalletClient({ account: w.account, transport }).writeContract({ chain: null, address: token, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [w.account.address, 1000n * 10n ** BigInt(await w.zeno.erc20.decimals(token))] });
  await chain.waitForTransactionReceipt({ hash: mint });
}
console.log(`      leader ${leader.account.address}, follower ${follower.account.address}`);

await leader.zeno.erc20.approve(token, leader.zeno.addresses.vault, "1000", wait);
await leader.zeno.vault.deposit(token, "1000", wait);

const { address: sub } = await follower.zeno.subaccounts.create(0n, wait);
await follower.zeno.subaccounts.deposit(sub, "100", { tx: wait });
await follower.zeno.subaccounts.setDelegate(sub, executor, true, wait);
check("follower's copy subaccount is funded and the executor is its delegate", (await follower.zeno.subaccounts.isDelegate(sub, executor)) && (await follower.zeno.subaccounts.balances(sub)).balance > 0n);

// ---- 2. Follow, signed --------------------------------------------------------------------------------------------
const decimals = BigInt(await follower.zeno.erc20.decimals(token));
const terms = {
  follower: follower.account.address,
  leader: leader.account.address,
  subaccount: sub,
  maxTradeSize: (1000n * 10n ** decimals).toString(),
  maxExposure: (2000n * 10n ** decimals).toString(),
  maxLeverage: 5,
  markets: null,
  issuedAt: Math.floor(Date.now() / 1000),
};
const followed = await api("/v1/copy/follows", { ...terms, signature: await follower.account.signMessage({ message: copyFollowMessage(terms) }) });
check("signed follow is accepted", followed.status === 200 && followed.json.active === true, JSON.stringify(followed.json));
const forged = await api("/v1/copy/follows", { ...terms, issuedAt: terms.issuedAt + 1, signature: await leader.account.signMessage({ message: copyFollowMessage({ ...terms, issuedAt: terms.issuedAt + 1 }) }) });
check("a follow signed by another wallet is refused", forged.status === 401, `${forged.status}`);
const count = await api(`/v1/copy/followers/${leader.account.address}`);
check("leader shows one follower", count.json.followers === 1, JSON.stringify(count.json));

// ---- 3. Leader opens: the keeper copies it ----------------------------------------------------------------------
const opened = await leader.zeno.perps.openPosition({ market: MARKET, side: "LONG", collateral: "100", leverage: 2 });
await chain.waitForTransactionReceipt({ hash: opened.hash });
console.log(`      leader opened ${MARKET} long #${opened.positionId}`);
const copied = await until("the copy to open", execution("open"));
check("keeper opened the copy in the subaccount", Boolean(copied?.followerPositionId), JSON.stringify(copied ?? (await execution("skipped")())));
if (copied?.followerPositionId) {
  const mine = (await follower.zeno.portfolio.positions(sub)).perps.find((p) => p.positionId === BigInt(copied.followerPositionId));
  // Leader posted 100 of a ~1000 balance (less the open fee); the copy posts the same share of the follower's 100: 10 to 10.1.
  check("copy is open, long, at 2x, sized in proportion", Boolean(mine?.open && mine.isLong && mine.leverage === 2n && mine.collateral >= 10n * 10n ** decimals && mine.collateral <= 101n * 10n ** decimals / 10n), mine ? `collateral ${mine.collateral}` : "missing");
}

// ---- 4. Leader closes: the keeper closes the copy -----------------------------------------------------------------
await chain.waitForTransactionReceipt({ hash: await leader.zeno.perps.closePosition(opened.positionId, {}) });
const closed = copied ? await until("the copy to close", execution("closed")) : undefined;
check("keeper closed the copy when the leader closed", Boolean(closed), JSON.stringify(closed));
if (closed) check("copy position is closed on chain", !(await follower.zeno.portfolio.positions(sub)).perps.some((p) => p.open));

// ---- 5. Stop following ----------------------------------------------------------------------------------------------
const stop = { follower: follower.account.address, leader: leader.account.address, issuedAt: Math.floor(Date.now() / 1000) };
const stopped = await api("/v1/copy/unfollow", { ...stop, signature: await follower.account.signMessage({ message: copyUnfollowMessage(stop) }) });
const after = await api(`/v1/copy/follows?follower=${follower.account.address}`);
check("signed stop turns the follow off", stopped.status === 200 && after.json.follows[0]?.active === false, JSON.stringify(stopped.json));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
