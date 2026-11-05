#!/usr/bin/env node
// pnpm testnet:verify | pnpm mainnet:verify
// Checks every ZENOMARKETS contract on a Robinhood Chain network, live, and prints its name, address and explorer link.
// Interactive in a terminal (arrow keys + Enter); `--all` runs everything without the menu, `--fast` skips the animation.
//   testnet  bytecode on chain (RPC) + verified source on Blockscout.
//   mainnet  compiles the contracts from this repo, then compares the bytecode on chain with it byte for byte: each
//            proxy against OpenZeppelin's ERC1967Proxy and the implementation behind it (EIP-1967 slot) against its
//            source. Only the RPC is used, so nothing depends on the explorer. Ends with the live state of the venue.
// Reads only public data: the deployment record in packages/contracts/deployments and public endpoints.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import readline from "node:readline";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const NETWORKS = {
  testnet: {
    label: "TESTNET VERIFY",
    name: "Robinhood Chain Testnet",
    chainId: 46630,
    rpc: process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    record: "robinhood_testnet",
    app: "https://testnet.zenomarkets.tech",
    source: false,
  },
  mainnet: {
    label: "MAINNET VERIFY",
    name: "Robinhood Chain",
    chainId: 4663,
    rpc: process.env.MAINNET_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    record: "robinhood_mainnet",
    app: "https://zenomarkets.tech",
    source: true,
  },
};
const NET = NETWORKS[args.find((a) => !a.startsWith("--")) ?? "testnet"];
if (!NET) {
  console.error("usage: node scripts/verify-contracts.mjs [testnet|mainnet] [--all] [--fast]");
  process.exit(2);
}
const REPO = "https://github.com/Zeno-Markets/zenomarkets";
const CONTRACTS = resolve(ROOT, "packages/contracts");
const FAST = flags.has("--fast");
const TTY = process.stdout.isTTY && process.stdin.isTTY;

/* ---------- look ---------- */
const rgb = (r, g, b) => (s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
const bg = (r, g, b) => (s) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`;
const lime = rgb(210, 245, 58);
const olive = rgb(132, 168, 0);
const ink = rgb(10, 12, 5);
const text = rgb(238, 242, 226);
const muted = rgb(164, 169, 149);
const faint = rgb(98, 101, 90);
const red = rgb(255, 107, 94);
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const link = (url, label = url) => `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
const hide = () => process.stdout.write("\x1b[?25l");
const show = () => process.stdout.write("\x1b[?25h");
const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
const out = (s = "") => process.stdout.write(`${s}\n`);
const visible = (s) => s.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g, "");
const pad = (s, n) => s + " ".repeat(Math.max(0, n - visible(s).length));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
process.on("exit", show);
process.on("SIGINT", () => {
  show();
  out();
  process.exit(130);
});

const LOGO = [
  "███████╗███████╗███╗   ██╗ ██████╗ ",
  "╚══███╔╝██╔════╝████╗  ██║██╔═══██╗",
  "  ███╔╝ █████╗  ██╔██╗ ██║██║   ██║",
  " ███╔╝  ██╔══╝  ██║╚██╗██║██║   ██║",
  "███████╗███████╗██║ ╚████║╚██████╔╝",
  "╚══════╝╚══════╝╚═╝  ╚═══╝ ╚═════╝ ",
];

async function banner() {
  console.clear();
  out();
  for (let i = 0; i < LOGO.length; i++) {
    // A lime-to-olive fade down the mark, like the glass logo.
    const t = i / (LOGO.length - 1);
    const paint = rgb(Math.round(210 - 78 * t), Math.round(245 - 77 * t), Math.round(58 - 58 * t));
    out(`   ${paint(LOGO[i])}${i === 2 ? `   ${bold(text("M A R K E T S"))}` : ""}${i === 3 ? `   ${muted("One view. A world of markets.")}` : ""}`);
    await sleep(55);
  }
  out();
  out(`   ${bg(210, 245, 58)(ink(bold(` ${NET.label} `)))}  ${muted(`${NET.name} · chain ${NET.chainId}`)}`);
  out(`   ${faint(NET.source ? "Live check: the bytecode on chain is byte-for-byte the open-source code in this repo" : "Live check: bytecode on chain (RPC) + verified source on Blockscout")}`);
  out();
}

/* ---------- data ---------- */
const deployments = JSON.parse(readFileSync(resolve(CONTRACTS, `deployments/${NET.record}.json`), "utf8"));
const NAMES = {
  marketRegistry: ["ZenoMarketRegistry", "Lists every market and its parameters"],
  vault: ["ZenoVault", "Holds collateral, settles every trade"],
  collateralManager: ["ZenoCollateralManager", "Ledger of what each account deposited"],
  feeManager: ["ZenoFeeManager", "Collects trading fees"],
  buybackModule: ["ZenoBuybackModule", "Routes revenue to the token buyback"],
  riskManager: ["ZenoRiskManager", "Leverage tiers and open-interest caps"],
  oracleRouter: ["ZenoOracleRouter", "Routes mark and index prices"],
  priceValidator: ["ZenoPriceValidator", "Rejects stale or out-of-band prices"],
  perpsEngine: ["ZenoPerpsEngine", "Opens and closes perpetual positions"],
  perpPositionManager: ["ZenoPerpPositionManager", "Stores perpetual positions"],
  perpOrderManager: ["ZenoPerpOrderManager", "Limit, stop-loss and take-profit orders"],
  fundingManager: ["ZenoFundingManager", "Funding between longs and shorts"],
  liquidationEngine: ["ZenoLiquidationEngine", "Liquidates under-margined positions"],
  rfqManager: ["ZenoRFQManager", "Request-for-quote block trades"],
  optionsEngine: ["ZenoOptionsEngine", "Prices and settles calls and puts"],
  optionMarket: ["ZenoOptionMarket", "Option series and open interest"],
  optionPositionManager: ["ZenoOptionPositionManager", "Stores option positions"],
  insuranceFund: ["ZenoInsuranceFund", "Covers liquidation shortfalls"],
  crossMargin: ["ZenoCrossMarginManager", "Account-wide cross margin"],
  subaccountFactory: ["ZenoSubaccountFactory", "Creates subaccounts"],
  creditOracle: ["ZenoCompositeSanityOracle", "Collateral price with jump guard"],
  creditRegistry: ["ZenoCreditRegistry", "Lending pairs and their limits"],
  creditRouter: ["ZenoCreditRouter", "Deposit and borrow in one transaction"],
  creditVault: ["ZenoCreditVault", "USDG lending vault (ERC-4626)"],
  creditPairTslaUsdg: ["ZenoCreditPair", "TSLA-backed USDG loans"],
  settlementToken: ["ZenoTestToken · USDG", "Testnet settlement dollar"],
};
const TRADING = ["marketRegistry", "vault", "collateralManager", "perpsEngine", "perpPositionManager", "perpOrderManager", "fundingManager", "liquidationEngine", "rfqManager", "optionsEngine", "optionMarket", "optionPositionManager", "oracleRouter", "priceValidator", "riskManager", "crossMargin", "insuranceFund", "feeManager", "buybackModule", "subaccountFactory"];
const GROUPS = [
  { id: "trading", title: "Trading core", hint: "perps, options, vault, risk, oracle", keys: TRADING },
  { id: "lending", title: "Lending & borrowing", hint: "pair, vault, registry, router, oracle", keys: ["creditPairTslaUsdg", "creditVault", "creditRegistry", "creditRouter", "creditOracle"] },
  NET.source
    ? { id: "assets", title: "Price feeds", hint: "one Chainlink feed adapter per market", keys: [], markets: true, count: "1 per market" }
    : { id: "assets", title: "Market assets", hint: "USDG + every market's token and price feed", keys: ["settlementToken"], markets: true, count: "1 + 2 per market" },
].filter((g) => g.markets || g.keys.some((k) => deployments[k])); // a release without lending has no lending group

async function rpc(method, params) {
  const response = await fetch(NET.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const addr = (w) => `0x${w.slice(24)}`;

/// Every listed market's token and feed (testnet), or its feed (mainnet: the tokens are Robinhood's own), read from
/// the registry and the oracle router.
async function marketAssets() {
  const ids = await call(deployments.marketRegistry, "0x5dc06f4d"); // allMarketIds()
  const count = parseInt(word(ids, 1), 16);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = word(ids, 2 + i);
    const symbol = Buffer.from(id, "hex").toString("utf8").replace(/\0+$/, "");
    const [config, feed] = await Promise.all([call(deployments.marketRegistry, `0xc3c95c7b${id}`), call(deployments.oracleRouter, `0x5f277a62${id}`)]);
    if (NET.source) {
      rows.push({ name: `ZenoChainlinkPriceFeed · ${symbol}`, contract: "ZenoChainlinkPriceFeed", role: `${symbol} price, read from its Chainlink feed`, address: addr(word(feed, 0)) });
      continue;
    }
    rows.push({ name: `ZenoTestToken · ${symbol}`, role: `${symbol} market token`, address: addr(word(config, 1)).toLowerCase() });
    rows.push({ name: `ZenoTestnetFeed · ${symbol}`, role: `${symbol} price feed (tracks the real market)`, address: addr(word(feed, 0)).toLowerCase() });
  }
  return rows;
}

/* ---------- testnet: the explorer ---------- */
async function explorer(address) {
  return fetch(`${NET.explorer}/api/v2/addresses/${address}`, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
}

/// One contract: bytecode from the RPC, and from Blockscout its checksummed address, verified source and, for a proxy,
/// the implementation's name and verified source.
async function inspectOnExplorer(item) {
  const [code, info] = await Promise.all([rpc("eth_getCode", [item.address, "latest"]).catch(() => "0x"), explorer(item.address)]);
  const impl = info.implementations?.[0];
  const implVerified = impl?.address_hash ? (await explorer(impl.address_hash)).is_verified === true : false;
  const live = typeof code === "string" && code.length > 2;
  return { address: info.hash ?? item.address, live, ok: live && info.is_verified === true && (!impl || implVerified), proxy: Boolean(impl), implName: impl?.name, implVerified };
}

/* ---------- mainnet: the source ---------- */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967
const artifacts = new Map();
function artifact(name) {
  if (!artifacts.has(name)) {
    const dir = resolve(CONTRACTS, `out/${name}.sol`);
    const file = [`${name}.json`, `${name}.default.json`].map((f) => resolve(dir, f)).find(existsSync);
    if (!file) throw new Error(`no compiled ${name} in packages/contracts/out`);
    artifacts.set(name, JSON.parse(readFileSync(file, "utf8")).deployedBytecode);
  }
  return artifacts.get(name);
}
/// The code without what a deployment legitimately fills in: the immutables (set in the constructor, zeroed at the
/// offsets the compiler lists) and the trailing CBOR metadata (a hash of the source paths and settings).
function comparable(hex, { immutableReferences }) {
  const code = Buffer.from(hex.replace(/^0x/, ""), "hex");
  for (const refs of Object.values(immutableReferences ?? {})) for (const { start, length } of refs) code.fill(0, start, start + length);
  return code.subarray(0, code.length - 2 - code.readUInt16BE(code.length - 2)).toString("hex");
}
const matches = (onChain, name) => onChain.length > 2 && comparable(onChain, artifact(name)) === comparable(artifact(name).object, artifact(name));

async function inspectAgainstSource(item) {
  const code = await rpc("eth_getCode", [item.address, "latest"]);
  const live = code.length > 2;
  if (!item.proxy) return { address: item.address, live, ok: live && matches(code, item.contract), proxy: false };
  const implAddress = addr((await rpc("eth_getStorageAt", [item.address, IMPLEMENTATION_SLOT, "latest"])).slice(2));
  const implCode = await rpc("eth_getCode", [implAddress, "latest"]);
  const implVerified = matches(implCode, item.contract);
  return { address: item.address, live, ok: live && matches(code, "ERC1967Proxy") && implVerified, proxy: true, implName: item.contract, implAddress, implVerified };
}
const inspect = NET.source ? inspectAgainstSource : inspectOnExplorer;

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/// `forge build` from packages/contracts, with a spinner: the bytecode is compared with what this machine compiles.
async function compile() {
  const settings = readFileSync(resolve(CONTRACTS, "foundry.toml"), "utf8");
  const solc = settings.match(/solc_version\s*=\s*"([^"]+)"/)?.[1] ?? "solc";
  const runs = settings.match(/optimizer_runs\s*=\s*(\d+)/)?.[1];
  let frame = 0;
  const spin = TTY ? setInterval(() => process.stdout.write(`\r\x1b[2K   ${lime(FRAMES[frame++ % FRAMES.length])} ${text("Compiling the contracts from source")} ${faint("forge build")}`), 70) : null;
  const started = Date.now();
  const [code, log] = await new Promise((done) => {
    let log = "";
    const child = spawn("forge", ["build"], { cwd: CONTRACTS });
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("error", (e) => done([1, `${e.message} (is Foundry installed? https://getfoundry.sh)`]));
    child.on("close", (c) => done([c, log]));
  });
  await sleep(Math.max(0, 900 - (Date.now() - started)));
  if (spin) clearInterval(spin);
  process.stdout.write("\r\x1b[2K");
  if (code !== 0) throw new Error(`forge build failed:\n${log.trim().split("\n").slice(-6).join("\n")}`);
  out(`   ${lime("✓")} ${text("Compiled from source")} ${faint(`· solc ${solc}${runs ? ` · optimizer ${runs} runs` : ""} · ${link(REPO, REPO.replace("https://", ""))}`)}`);
  const block = parseInt(await rpc("eth_blockNumber", []), 16);
  out(`   ${lime("✓")} ${text(`Connected to ${NET.name}`)} ${faint(`· chain ${parseInt(await rpc("eth_chainId", []), 16)} · block #${block.toLocaleString("en-US")}`)}`);
  out();
}

/* ---------- menu ---------- */
async function menu() {
  const options = [...GROUPS.map((g) => ({ ...g, count: g.count ?? `${g.keys.filter((k) => deployments[k]).length}` })), { id: "all", title: "Everything", hint: "the whole deployment", count: "all" }];
  if (!TTY || flags.has("--all")) return options.at(-1);
  let index = options.length - 1;
  const draw = (first) => {
    if (!first) process.stdout.write(`\x1b[${options.length + 2}A`);
    out(`   ${bold(text("What should we verify?"))}  ${faint("↑ ↓ to move · enter to start · q to quit")}`);
    out();
    options.forEach((o, i) => {
      const on = i === index;
      const marker = on ? lime("▶") : " ";
      const title = on ? bg(210, 245, 58)(ink(bold(` ${o.title} `))) : text(` ${o.title} `);
      out(`\x1b[2K   ${marker} ${title} ${muted(o.hint)} ${faint(`· ${o.count}`)}`);
    });
  };
  hide();
  draw(true);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  return new Promise((done) => {
    process.stdin.on("keypress", function onKey(_, key) {
      if (key.name === "up") index = (index + options.length - 1) % options.length;
      else if (key.name === "down") index = (index + 1) % options.length;
      else if (/^[1-9]$/.test(key.sequence ?? "") && Number(key.sequence) <= options.length) index = Number(key.sequence) - 1;
      else if (key.name === "q" || (key.ctrl && key.name === "c")) {
        show();
        process.exit(0);
      } else if (key.name === "return") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", onKey);
        process.stdin.pause();
        out();
        return done(options[index]);
      }
      draw(false);
    });
  });
}

/* ---------- run ---------- */
async function row(n, total, item, pending) {
  const label = `${faint(String(n).padStart(2, "0"))}${faint("/")}${faint(String(total).padStart(2, "0"))}`;
  let frame = 0;
  const checking = NET.source ? "comparing bytecode with source…" : "checking chain + explorer…";
  const spin = !FAST && TTY ? setInterval(() => process.stdout.write(`\r\x1b[2K   ${label}  ${lime(FRAMES[frame++ % FRAMES.length])} ${text(item.name)} ${faint(checking)}`), 70) : null;
  const [result] = await Promise.all([pending, sleep(260)]);
  if (spin) clearInterval(spin);
  const okLabel = NET.source ? " ✓ MATCHES SOURCE " : " ✓ VERIFIED ";
  const failLabel = NET.source ? " ✗ DIFFERS FROM SOURCE " : " ✗ UNVERIFIED ";
  const badge = result.ok ? bg(210, 245, 58)(ink(bold(okLabel))) : bg(255, 107, 94)(ink(bold(result.live ? failLabel : " ✗ NO CODE ")));
  const url = `${NET.explorer}/address/${result.address}?tab=contract`;
  const proxyNote = !result.proxy
    ? ""
    : NET.source
      ? ` · proxy (ERC1967) → implementation ${short(result.implAddress)}${result.implVerified ? ", both equal to source" : ""}`
      : ` · proxy → ${result.implName ?? "implementation"}${result.implVerified ? " (verified)" : ""}`;
  process.stdout.write("\r\x1b[2K");
  out(`   ${label}  ${result.ok ? lime("●") : red("●")} ${pad(bold(text(item.name)), 34)} ${badge}`);
  out(`          ${muted("address ")} ${text(result.address)}`);
  out(`          ${muted("explorer")} ${olive(link(url, url.replace("https://", "").replace("?tab=contract", "")))}`);
  out(`          ${faint(`${item.role}${proxyNote}`)}`);
  out();
  return result.ok;
}

/// What the venue holds right now (mainnet), read from the contracts just checked.
async function liveState() {
  const token = deployments.settlementToken;
  const [ids, pool, share, decimals, symbol] = await Promise.all([
    call(deployments.marketRegistry, "0x5dc06f4d"), // allMarketIds()
    call(deployments.vault, `0x68abb5e0${token.slice(2).toLowerCase().padStart(64, "0")}`), // poolBalance(address)
    call(deployments.feeManager, "0xb1ccb4ac"), // buybackShareBps()
    call(token, "0x313ce567"), // decimals()
    call(token, "0x95d89b41"), // symbol()
  ]);
  const name = Buffer.from(word(symbol, 2), "hex").toString("utf8").slice(0, parseInt(word(symbol, 1), 16));
  const amount = Number(BigInt(`0x${word(pool, 0)}`)) / 10 ** parseInt(word(decimals, 0), 16);
  const facts = [
    ["Markets", `${parseInt(word(ids, 1), 16)} live · stocks, ETFs, crypto, commodities`],
    ["Settlement", `${name} · ${short(token)}`],
    ["Trading pool", `${amount.toFixed(2)} ${name}`],
    ["Buyback", `${parseInt(word(share, 0), 16) / 100}% of every trading fee → ZenoBuybackModule`],
  ];
  out(`   ${lime("▌")} ${bold(text("LIVE ON CHAIN"))}`);
  for (const [k, v] of facts) {
    out(`   ${muted(pad(k, 14))}${text(v)}`);
    await sleep(140);
  }
  out();
}

async function main() {
  await banner();
  if (NET.source) await compile();
  const choice = await menu();
  hide();
  const groups = choice.id === "all" ? GROUPS : GROUPS.filter((g) => g.id === choice.id);
  let items = [];
  for (const g of groups) {
    for (const key of g.keys) if (deployments[key]) items.push({ group: g.title, name: NAMES[key][0], contract: NAMES[key][0], proxy: key !== "settlementToken", role: NAMES[key][1], address: deployments[key] });
    if (g.markets) {
      process.stdout.write(`   ${faint("reading the market registry…")}`);
      items.push(...(await marketAssets()).map((r) => ({ ...r, group: g.title })));
      process.stdout.write("\r\x1b[2K");
    }
  }
  // Six checks run at a time (the explorer rate-limits bursts); the rows are revealed in order.
  const results = [];
  let next = 0;
  const lanes = Array.from({ length: 6 }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = inspect(items[i]).catch(() => ({ address: items[i].address, live: false, ok: false }));
      await results[i];
    }
  });
  const ready = (i) => (async () => { while (!results[i]) await new Promise((r) => setTimeout(r, 20)); return results[i]; })();
  void Promise.all(lanes);
  let passed = 0;
  let group = "";
  const started = Date.now();
  for (let i = 0; i < items.length; i++) {
    if (items[i].group !== group) {
      group = items[i].group;
      out(`   ${lime("▌")} ${bold(text(group.toUpperCase()))}`);
      out(`   ${faint("─".repeat(78))}`);
    }
    if (await row(i + 1, items.length, items[i], ready(i))) passed++;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const all = passed === items.length;
  if (NET.source && all) await liveState();
  const line = "━".repeat(78);
  const verdict = all
    ? NET.source
      ? "Every contract on chain is byte-for-byte the open-source code."
      : "Every contract is live on chain and its source is public."
    : "Some contracts need attention (see the red rows).";
  out(`   ${all ? lime(line) : red(line)}`);
  out(`   ${all ? bg(210, 245, 58)(ink(bold(` ${passed}/${items.length} VERIFIED `))) : bg(255, 107, 94)(ink(bold(` ${passed}/${items.length} VERIFIED `)))}  ${text(verdict)}`);
  out(`   ${muted("Network ")} ${NET.name} (${NET.chainId})   ${muted("Checked in")} ${seconds}s   ${muted("Explorer")} ${olive(link(NET.explorer, NET.explorer.replace("https://", "")))}`);
  out(`   ${muted(NET.source ? "Source  " : "App     ")} ${NET.source ? `${olive(link(REPO, REPO.replace("https://", "")))}   ` : ""}${NET.source ? muted("App") : ""}${NET.source ? " " : ""}${olive(link(NET.app, NET.app.replace("https://", "")))}   ${muted("X")} ${olive(link("https://x.com/UseZenoMarkets", "@UseZenoMarkets"))}`);
  out(`   ${all ? lime(line) : red(line)}`);
  out();
  show();
  process.exit(all ? 0 : 1);
}

main().catch((error) => {
  show();
  out(red(`   ✗ ${error.message}`));
  out(muted("   Check the connection to the RPC and the explorer, then run it again."));
  process.exit(1);
});
