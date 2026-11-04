/// Opens and closes one small perp on a live testnet market and prints the transaction hashes, so a
/// new market has proof it trades. Mints its own collateral (the testnet token has a public `mint`).
///
///   PRIVATE_KEY=0x... RPC_URL=... MARKET=BTC [FUND_POOL=100000] pnpm --filter @zeno/sdk perp:testnet
///
/// `FUND_POOL` tops up the vault pool by that many whole tokens first; the vault refuses a profit
/// credit larger than the pool (`InsufficientPoolReserves`).
import assert from "node:assert/strict";
import { createWalletClient, http, parseAbi, parseUnits, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAddresses, resolveChainId } from "@zeno/config";
import { Zeno } from "../src/index.js";

const key = process.env.PRIVATE_KEY as Hex | undefined;
const rpcUrl = process.env.RPC_URL;
const market = process.env.MARKET;
if (!key || !rpcUrl || !market) throw new Error("Set PRIVATE_KEY, RPC_URL and MARKET.");

const chainId = resolveChainId(process.env.CHAIN_ID);
const addresses = resolveAddresses(chainId);
const account = privateKeyToAccount(key);
const zeno = new Zeno({ chainId, transport: http(rpcUrl), account, addresses });
const wallet = createWalletClient({ account, transport: http(rpcUrl) }).extend(publicActions);
const token = addresses.settlementToken as Address;
const decimals = await wallet.readContract({ address: token, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });

const send = async (functionName: "mint" | "fundPool", address: Address, signature: string, args: readonly unknown[]) => {
  const hash = await wallet.writeContract({ address, abi: parseAbi([signature]), chain: null, functionName, args } as never);
  await wallet.waitForTransactionReceipt({ hash });
  return hash;
};

const fund = Number(process.env.FUND_POOL ?? 0);
if (fund > 0) {
  const amount = parseUnits(String(fund), decimals);
  console.log("mint", await send("mint", token, "function mint(address to, uint256 amount)", [account.address, amount]));
  await zeno.erc20.approve(token, addresses.vault, String(fund), { wait: true });
  console.log("fundPool", await send("fundPool", addresses.vault as Address, "function fundPool(address token, uint256 amount)", [token, amount]));
}

console.log("mint", await send("mint", token, "function mint(address to, uint256 amount)", [account.address, parseUnits("1000", decimals)]));
await zeno.erc20.approve(token, addresses.vault, "1000", { wait: true });
await zeno.vault.deposit(token, "500", { wait: true });

const opened = await zeno.perps.openPosition({ market, side: "LONG", collateral: "100", leverage: 2, tx: { wait: true } });
console.log(`open ${market} #${opened.positionId}`, opened.hash);
const closeHash = await zeno.perps.closePosition(opened.positionId, { tx: { wait: true } });
assert.equal((await zeno.portfolio.getPerpPosition(opened.positionId)).open, false);
console.log(`close ${market} #${opened.positionId}`, closeHash);
