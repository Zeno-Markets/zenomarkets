#!/usr/bin/env node
// pnpm testnet:verify
// Checks every ZENOMARKETS contract on Robinhood Chain Testnet, live: code on chain (RPC) and verified source on
// Blockscout, then prints its name, address and explorer link. Interactive in a terminal (arrow keys + Enter);
// `pnpm testnet:verify --all` runs everything without the menu, `--fast` skips the animation.
// Reads only public data: the deployment record in packages/contracts/deployments and two public endpoints.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import readline from "node:readline";

const ROOT = resolve(import.meta.dirname, "..");
const RPC = process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const args = new Set(process.argv.slice(2));
const FAST = args.has("--fast");
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
  out(`   ${bg(210, 245, 58)(ink(bold(" TESTNET VERIFY ")))}  ${muted("Robinhood Chain Testnet · chain 46630")}`);
  out(`   ${faint("Live check: bytecode on chain (RPC) + verified source on Blockscout")}`);
  out();
}

/* ---------- data ---------- */
const deployments = JSON.parse(readFileSync(resolve(ROOT, "packages/contracts/deployments/robinhood_testnet.json"), "utf8"));
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
const GROUPS = [
  { id: "trading", title: "Trading core", hint: "perps, options, vault, risk, oracle", keys: ["marketRegistry", "vault", "collateralManager", "perpsEngine", "perpPositionManager", "perpOrderManager", "fundingManager", "liquidationEngine", "rfqManager", "optionsEngine", "optionMarket", "optionPositionManager", "oracleRouter", "priceValidator", "riskManager", "crossMargin", "insuranceFund", "feeManager", "buybackModule", "subaccountFactory"] },
  { id: "lending", title: "Lending & borrowing", hint: "pair, vault, registry, router, oracle", keys: ["creditPairTslaUsdg", "creditVault", "creditRegistry", "creditRouter", "creditOracle"] },
  { id: "assets", title: "Market assets", hint: "USDG + every market's token and price feed", keys: ["settlementToken"], markets: true },
];

async function rpc(method, params) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const word = (hex, i) => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const addr = (w) => `0x${w.slice(24)}`;

/// Every listed market's token and feed, read from the registry and the oracle router.
async function marketAssets() {
  const ids = await call(deployments.marketRegistry, "0x5dc06f4d"); // allMarketIds()
  const count = parseInt(word(ids, 1), 16);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = word(ids, 2 + i);
    const symbol = Buffer.from(id, "hex").toString("utf8").replace(/\0+$/, "");
    const [config, feed] = await Promise.all([call(deployments.marketRegistry, `0xc3c95c7b${id}`), call(deployments.oracleRouter, `0x5f277a62${id}`)]);
    rows.push({ name: `ZenoTestToken · ${symbol}`, role: `${symbol} market token`, address: addr(word(config, 1)).toLowerCase() });
    rows.push({ name: `ZenoTestnetFeed · ${symbol}`, role: `${symbol} price feed (tracks the real market)`, address: addr(word(feed, 0)).toLowerCase() });
  }
  return rows;
}

async function explorer(address) {
  return fetch(`${EXPLORER}/api/v2/addresses/${address}`, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
}

/// One contract: bytecode from the RPC, and from Blockscout its checksummed address, verified source and, for a proxy,
/// the implementation's name and verified source.
async function inspect(address) {
  const [code, info] = await Promise.all([rpc("eth_getCode", [address, "latest"]).catch(() => "0x"), explorer(address)]);
  const impl = info.implementations?.[0];
  const implVerified = impl?.address_hash ? (await explorer(impl.address_hash)).is_verified === true : false;
  return { address: info.hash ?? address, live: typeof code === "string" && code.length > 2, verified: info.is_verified === true, proxy: Boolean(impl), implName: impl?.name, implVerified };
}

/* ---------- menu ---------- */
async function menu() {
  const options = [...GROUPS.map((g) => ({ ...g, count: g.markets ? "1 + 2 per market" : `${g.keys.length}` })), { id: "all", title: "Everything", hint: "the whole deployment", count: "all" }];
  if (!TTY || args.has("--all")) return options.at(-1);
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
      else if (/^[1-4]$/.test(key.sequence)) index = Number(key.sequence) - 1;
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
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

async function row(n, total, item, pending) {
  const label = `${faint(String(n).padStart(2, "0"))}${faint("/")}${faint(String(total).padStart(2, "0"))}`;
  let frame = 0;
  const spin = !FAST && TTY ? setInterval(() => process.stdout.write(`\r\x1b[2K   ${label}  ${lime(FRAMES[frame++ % FRAMES.length])} ${text(item.name)} ${faint("checking chain + explorer…")}`), 70) : null;
  const [result] = await Promise.all([pending, sleep(260)]);
  if (spin) clearInterval(spin);
  const ok = result.live && result.verified && (!result.proxy || result.implVerified);
  const badge = ok ? bg(210, 245, 58)(ink(bold(" ✓ VERIFIED "))) : result.live ? bg(255, 107, 94)(ink(bold(" ✗ UNVERIFIED "))) : bg(255, 107, 94)(ink(bold(" ✗ NO CODE ")));
  const address = result.address;
  const url = `${EXPLORER}/address/${address}?tab=contract`;
  process.stdout.write("\r\x1b[2K");
  out(`   ${label}  ${ok ? lime("●") : red("●")} ${pad(bold(text(item.name)), 34)} ${badge}`);
  out(`          ${muted("address ")} ${text(address)}`);
  out(`          ${muted("explorer")} ${olive(link(url, url.replace("https://", "").replace("?tab=contract", "")))}`);
  out(`          ${faint(`${item.role}${result.proxy ? ` · proxy → ${result.implName ?? "implementation"}${result.implVerified ? " (verified)" : ""}` : ""}`)}`);
  out();
  return ok;
}

async function main() {
  await banner();
  const choice = await menu();
  hide();
  const groups = choice.id === "all" ? GROUPS : GROUPS.filter((g) => g.id === choice.id);
  let items = [];
  for (const g of groups) {
    for (const key of g.keys) if (deployments[key]) items.push({ group: g.title, name: NAMES[key][0], role: NAMES[key][1], address: deployments[key] });
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
      results[i] = inspect(items[i].address);
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
  const line = "━".repeat(78);
  out(`   ${all ? lime(line) : red(line)}`);
  out(`   ${all ? bg(210, 245, 58)(ink(bold(` ${passed}/${items.length} VERIFIED `))) : bg(255, 107, 94)(ink(bold(` ${passed}/${items.length} VERIFIED `)))}  ${text(all ? "Every contract is live on chain and its source is public." : "Some contracts need attention (see the red rows).")}`);
  out(`   ${muted("Network ")} Robinhood Chain Testnet (46630)   ${muted("Checked in")} ${seconds}s   ${muted("Explorer")} ${olive(link(EXPLORER, EXPLORER.replace("https://", "")))}`);
  out(`   ${muted("App     ")} ${olive(link("https://testnet.zenomarkets.tech", "testnet.zenomarkets.tech"))}   ${muted("X")} ${olive(link("https://x.com/UseZenoMarkets", "@UseZenoMarkets"))}`);
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
