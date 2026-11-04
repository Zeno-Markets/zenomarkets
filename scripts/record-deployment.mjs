#!/usr/bin/env node
// Records a fresh deployment in packages/config: the proxy addresses (sync-deployments) and the code behind each
// proxy (core implementations from DeployAll's file, credit implementations from each proxy's EIP-1967 slot, and the
// upgrade placeholder from the DeployAll broadcast). Usage: node scripts/record-deployment.mjs robinhood_testnet
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const network = process.argv[2] ?? "robinhood_testnet";
const chainId = network === "robinhood_mainnet" ? 4663 : 46630;
const rpc = process.env.RPC_URL ?? (chainId === 4663 ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");
const root = resolve(import.meta.dirname, "..");
const deployments = resolve(root, "packages/contracts/deployments");
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

execFileSync("pnpm", ["--filter", "@zeno/config", "sync:deployments", network], { cwd: root, stdio: "inherit" });

const proxies = JSON.parse(readFileSync(resolve(deployments, `${network}.json`), "utf8"));
const core = JSON.parse(readFileSync(resolve(deployments, `${network}.implementations.json`), "utf8"));

async function implementationOf(proxy) {
  const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getStorageAt", params: [proxy, IMPL_SLOT, "latest"] }) });
  const { result } = await response.json();
  const address = `0x${result.slice(-40)}`;
  if (/^0x0{40}$/.test(address)) throw new Error(`${proxy} is not an ERC-1967 proxy`);
  return execFileSync("cast", ["to-check-sum-address", address]).toString().trim();
}

const implementations = { ...core };
for (const key of ["creditRegistry", "creditRouter", "creditVault", "creditPairTslaUsdg"]) {
  if (proxies[key]) implementations[key] = await implementationOf(proxies[key]);
}

const broadcast = JSON.parse(readFileSync(resolve(root, `packages/contracts/broadcast/DeployAll.s.sol/${chainId}/run-latest.json`), "utf8"));
const placeholder = broadcast.transactions.find((tx) => tx.contractName === "ZenoUpgradePlaceholder")?.contractAddress;

const constName = `${network.replace(/_(\w)/g, (_, c) => c.toUpperCase())}Implementations`;
const source = resolve(root, "packages/config/src/deployments.ts");
const text = readFileSync(source, "utf8");
const literal = new RegExp(`const ${constName}: ImplementationRecord = \\{[\\s\\S]*?\\n\\};`);
if (!literal.test(text)) throw new Error(`${constName} literal not found in deployments.ts`);
const checksum = (a) => execFileSync("cast", ["to-check-sum-address", a]).toString().trim();
const body = Object.keys(implementations).sort().map((key) => `    ${key}: "${checksum(implementations[key])}",`).join("\n");
const record = `const ${constName}: ImplementationRecord = {\n  implementations: {\n${body}\n  },${placeholder ? `\n  upgradePlaceholder: "${checksum(placeholder)}",` : ""}\n};`;
writeFileSync(source, text.replace(literal, record));
writeFileSync(resolve(deployments, `${network}.implementations.json`), `${JSON.stringify(implementations, null, 2)}\n`);
console.log(`Recorded ${Object.keys(implementations).length} implementations${placeholder ? " and the placeholder" : ""} for ${network}.`);
