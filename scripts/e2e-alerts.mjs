// End-to-end proof of smart price alerts on a local stack: a scratch Postgres, the real API and web build, a real
// browser (Playwright Chromium with notifications granted and an injected test wallet), and the real indexer binary
// run as one pass at a time (INDEXER_RUN_ONCE) with no browser open. Prices are direct tick inserts, so the run is
// repeatable at any hour; the chain RPC given to the indexer is a dead address so no live tick can override them.
//
//   E2E_DATABASE_URL=postgres://postgres@127.0.0.1:55432/zeno_test   (scratch: its alert tables are emptied)
//   PLAYWRIGHT_DIR=~/.npm/_npx/<hash>   (a directory with node_modules/playwright)
//   WEB_URL=http://127.0.0.1:3100  API_URL=http://127.0.0.1:4001   (web built by `scripts/web-testnet.sh build`
//     with NEXT_PUBLIC_API_URL pointing at the API, and the API's CORS_ORIGINS allowing WEB_URL)
//   node scripts/e2e-alerts.mjs [screens-dir]
import { execFileSync, spawn } from "node:child_process";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fromIndexer = createRequire(join(root, "services/indexer/package.json"));
const { default: postgres } = await import(fromIndexer.resolve("postgres"));
const { stringToHex } = await import(fromIndexer.resolve("viem"));
const { privateKeyToAccount } = await import(fromIndexer.resolve("viem/accounts"));
const webpush = fromIndexer("web-push");
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? "", "/"))("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55432/zeno_test";
const WEB = process.env.WEB_URL ?? "http://127.0.0.1:3100";
const SHOTS = process.argv[2] ?? join(root, "docs/evidence/screens");
mkdirSync(SHOTS, { recursive: true });

const sql = postgres(DB);
const account = privateKeyToAccount(`0x${"77".repeat(32)}`);
const wallet = account.address.toLowerCase();
const NVDA = stringToHex("NVDA", { size: 32 });
const usd = (n) => (BigInt(Math.round(n * 100)) * 10n ** 16n).toString();

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const tick = (price) => sql`insert into price_ticks (market_id, price) values (${NVDA}, ${usd(price)})`;
const count = async (table, where = sql``) => Number((await sql`select count(*)::int as n from ${sql(table)} ${where}`)[0].n);

// --- A stand-in push service, to see what the indexer sends when no browser is open --------------------------------
const dir = mkdtempSync(join(tmpdir(), "e2e-push-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
const pushed = [];
const pushServer = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (request, response) => {
  const chunks = [];
  request.on("data", (c) => chunks.push(c));
  request.on("end", () => {
    pushed.push({ headers: request.headers, body: Buffer.concat(chunks) });
    response.statusCode = 201;
    response.end();
  });
});
await new Promise((resolve) => pushServer.listen(0, "127.0.0.1", resolve));
const endpoint = `https://127.0.0.1:${pushServer.address().port}/push/e2e`;
const subscriber = createECDH("prime256v1");
subscriber.generateKeys();
const auth = randomBytes(16);

/// RFC 8291: what a browser does with a push body, with the subscriber's own keys.
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const key = Buffer.from(hkdfSync("sha256", subscriber.computeSecret(serverPublic), auth, Buffer.concat([Buffer.from("WebPush: info\0"), subscriber.getPublicKey(), serverPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", key, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", key, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const sealed = body.subarray(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString("utf8"));
}

/// One pass of the real indexer. Its chain RPC is a dead address, so it samples no prices of its own.
const vapid = webpush.generateVAPIDKeys();
async function indexerPass() {
  // Asynchronous on purpose: the stand-in push service above lives in this process and must keep answering.
  const child = spawn("pnpm", ["--filter", "@zeno/indexer", "start"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: DB,
      CHAIN_ID: "46630",
      RPC_URL: "http://127.0.0.1:9",
      INDEXER_RUN_ONCE: "true",
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      VAPID_SUBJECT: "https://example.com",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const status = await new Promise((resolve) => child.on("close", resolve));
  const lines = output.split("\n").filter((line) => /alert|push/i.test(line));
  console.log(`      indexer pass exit ${status}${lines.length ? `: ${lines.join(" | ")}` : ""}`);
  return status;
}

// --- The browser ---------------------------------------------------------------------------------------------------
// The full Chromium in its new headless mode: the old headless shell reports notifications as denied whatever is granted.
const chrome = await chromium.launch({ channel: "chromium" });
async function openContext(width, height) {
  const context = await chrome.newContext({ viewport: { width, height }, baseURL: WEB });
  await context.grantPermissions(["notifications"], { origin: new URL(WEB).origin });
  await context.exposeFunction("__sign", (hex) => account.signMessage({ message: { raw: hex } }));
  await context.addInitScript((address) => {
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "0xb626";
        if (method === "net_version") return "46630";
        if (method === "personal_sign") return window.__sign(params[0]);
        return null;
      },
      on() {},
      removeListener() {},
    };
  }, account.address);
  return context;
}
async function connect(page) {
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
}

try {
  // Start clean.
  await sql`truncate price_alerts, notifications, push_subscriptions, price_ticks, markets restart identity`;
  await sql`insert into markets (market_id, underlying_token, oracle_id, options_enabled, perps_enabled, max_leverage, open_interest_cap, active, block_number)
    values (${NVDA}, '0x1', '0x2', false, true, '10', '0', true, 1)`;
  await tick(188.96);
  await sql`insert into push_subscriptions (endpoint, wallet, p256dh, auth) values (${endpoint}, ${wallet}, ${subscriber.getPublicKey().toString("base64url")}, ${auth.toString("base64url")})`;

  // ---- 1. Desktop: not connected, connect, set an alert through the review step, one signature ---------------------
  const desktop = await openContext(1440, 900);
  const page = await desktop.newPage();
  await page.goto("/alerts");
  await page.getByText("Connect a wallet to set price alerts").waitFor();
  check("not-connected state shows the connect action", await page.getByRole("button", { name: "Connect wallet" }).first().isVisible());
  await page.screenshot({ path: join(SHOTS, "alerts-not-connected-1440.png") });

  check("no service worker is registered on page load", (await page.evaluate(() => navigator.serviceWorker.getRegistrations())).length === 0);

  await connect(page);
  await page.getByText("New alert").first().waitFor();
  await page.getByText(/Price now \$/).waitFor({ timeout: 30_000 });
  // The market picker is a themed menu, not the browser's own white list.
  await page.getByRole("button", { name: /Market/ }).first().click();
  await page.getByRole("menuitemradio").first().waitFor();
  const menuBackground = await page.getByRole("menu").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("market picker menu uses the theme's raised fill, not white", menuBackground !== "rgb(255, 255, 255)" && menuBackground !== "rgba(0, 0, 0, 0)", menuBackground);
  await page.screenshot({ path: join(SHOTS, "alerts-market-menu-1440.png") });
  await page.getByRole("menuitemradio", { name: "NVDA-PERP" }).click();
  await page.getByLabel("Price (USD)").fill("200");
  await page.getByRole("button", { name: "Review" }).click();
  await page.getByRole("heading", { name: /Set alert: NVDA at or above \$200\.00/ }).waitFor();
  check("review step comes before the signature", true);
  await page.screenshot({ path: join(SHOTS, "alerts-review-1440.png") });
  await page.getByRole("button", { name: "Sign and set alert" }).click();
  await page.getByText("Alert set.").waitFor({ timeout: 20_000 });
  const [stored] = await sql`select wallet, symbol, kind, target, base_price, status from price_alerts`;
  check("alert stored for the signing wallet, above 200, based on the price at creation", stored?.wallet === wallet && stored.kind === "price_above" && stored.target === usd(200) && stored.base_price === usd(188.96) && stored.status === "active", JSON.stringify(stored));
  await page.getByRole("list", { name: "Active alerts" }).waitFor();
  await page.screenshot({ path: join(SHOTS, "alerts-active-1440.png") });

  // Browser notifications: the review step is the only way in, and it registers the worker only after the click.
  await page.getByRole("button", { name: "Enable browser notifications" }).click();
  await page.getByRole("heading", { name: "Enable browser notifications" }).waitFor();
  check("enabling browser notifications has its own review step", true);
  check("still no service worker before the confirm click", (await page.evaluate(() => navigator.serviceWorker.getRegistrations())).length === 0);
  await page.getByRole("button", { name: "Allow and sign" }).click();
  await page.waitForTimeout(8_000);
  const registered = (await page.evaluate(() => navigator.serviceWorker.getRegistrations())).length;
  const subscribeError = await page.locator("p.text-down").first().textContent().catch(() => null);
  console.log(`      enable click: worker registered=${registered}, shown error=${subscribeError ?? "none"}`);
  check("the worker is registered only after the confirm click", registered === 1 || Boolean(subscribeError));
  // Headless Chromium has no push service, so the browser refuses to subscribe; the page must say so in plain words.
  check("a browser that cannot subscribe gets a plain sentence, not a browser error code", !subscribeError || /could not reach its push service/.test(subscribeError), subscribeError ?? "subscribed");
  await page.screenshot({ path: join(SHOTS, "alerts-enable-push-1440.png") });

  // ---- 2. The browser is closed. Price moves past the target. One server pass. -------------------------------------
  await desktop.close();
  await tick(201.2);
  check("indexer pass 1 ran", (await indexerPass()) === 0);
  const [fired] = await sql`select status, trigger_price from price_alerts where wallet = ${wallet} and target = ${usd(200)}`;
  check("alert is triggered at the new price", fired?.status === "triggered" && fired.trigger_price === usd(201.2));
  check("exactly one notification row", (await count("notifications")) === 1);
  check("exactly one Web Push reached the push service, with no browser open", pushed.length === 1, `${pushed.length}`);
  const message = pushed[0] ? decrypt(pushed[0].body) : undefined;
  check("the push decrypts with the subscriber's keys to the alert text", message?.title === "NVDA at or above $200.00" && message.body === "Now $201.20." && message.url === "/alerts", JSON.stringify(message));

  // ---- 3. A second pass sends nothing --------------------------------------------------------------------------------
  check("indexer pass 2 ran", (await indexerPass()) === 0);
  check("second pass: still one notification", (await count("notifications")) === 1);
  check("second pass: still one Web Push", pushed.length === 1, `${pushed.length}`);

  // ---- 4. Back in the browser: the bell, the toast, the history, 1440 and 375 -------------------------------------
  const back = await openContext(1440, 900);
  const p2 = await back.newPage();
  await p2.goto("/alerts");
  await connect(p2);
  await p2.getByRole("button", { name: /Price alerts, 1 unread/ }).waitFor({ timeout: 30_000 });
  check("bell shows 1 unread", true);
  await p2.getByRole("button", { name: /Price alerts, 1 unread/ }).click();
  await p2.getByRole("menuitem", { name: /NVDA at or above \$200\.00/ }).waitFor();
  await p2.screenshot({ path: join(SHOTS, "alerts-bell-1440.png") });
  await p2.keyboard.press("Escape");
  check("bell unread clears once opened", (await p2.getByRole("button", { name: "Price alerts", exact: true }).count()) === 1);
  await p2.getByRole("list", { name: "Triggered alerts" }).waitFor();
  await p2.screenshot({ path: join(SHOTS, "alerts-history-1440.png"), fullPage: false });

  // A second alert fires while the page is open: a toast within one poll.
  await sql`insert into price_alerts (wallet, symbol, kind, target, base_price, issued_at) values (${wallet}, 'NVDA', 'price_below', ${usd(150)}, ${usd(201.2)}, ${Math.floor(Date.now() / 1000)})`;
  await tick(149);
  await indexerPass();
  await p2.getByText("NVDA at or below $150.00").first().waitFor({ timeout: 45_000 });
  check("an alert that fires while the page is open appears as a toast", await p2.getByText("Price alert", { exact: true }).isVisible());
  await p2.screenshot({ path: join(SHOTS, "alerts-toast-1440.png") });
  check("that second alert pushed once more (two in total)", pushed.length === 2, `${pushed.length}`);

  // The worker: a visible tab shows the alert itself; with no tab open the worker shows it.
  const registration = await p2.evaluate(async () => (await navigator.serviceWorker.register("/sw.js"), (await navigator.serviceWorker.ready).scope));
  const cdp = await back.newCDPSession(p2);
  const registrations = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => registrations.push(...event.registrations));
  await cdp.send("ServiceWorker.enable");
  await p2.waitForTimeout(1_500);
  const registrationId = registrations.find((r) => r.scopeURL.startsWith(WEB))?.registrationId;
  const worker = back.serviceWorkers()[0];
  check("the worker registers at the site root", registration === `${WEB}/` && Boolean(registrationId) && Boolean(worker), registration);
  const deliver = (data) => cdp.send("ServiceWorker.deliverPushMessage", { origin: WEB, registrationId, data: JSON.stringify(data) });
  const shown = () => worker.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url })));
  await deliver({ title: "while visible", body: "x", tag: "t1", url: "/alerts" });
  await p2.waitForTimeout(1_000);
  check("push with a visible tab: the worker leaves it to the page (no duplicate)", (await shown()).length === 0);
  await p2.goto("about:blank");
  await deliver({ title: "NVDA at or above $200.00", body: "Now $201.20.", tag: "alert-1", url: "/alerts" });
  await new Promise((r) => setTimeout(r, 1_000));
  const list = await shown();
  check("push with no tab open: the worker shows the notification", list.length === 1 && list[0].title === "NVDA at or above $200.00" && list[0].tag === "alert-1" && list[0].url === "/alerts", JSON.stringify(list));
  await back.close();

  // ---- 5. Phone width: 375 -----------------------------------------------------------------------------------------
  const phone = await openContext(375, 812);
  const p3 = await phone.newPage();
  await p3.goto("/alerts");
  await connect(p3);
  await p3.getByRole("list", { name: "Active alerts" }).waitFor({ timeout: 30_000 }).catch(() => {});
  await p3.waitForTimeout(1_500);
  const overflow = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("375 px: no horizontal page scroll", overflow <= 0, `${overflow}`);
  await p3.screenshot({ path: join(SHOTS, "alerts-375.png"), fullPage: true });
  await p3.getByRole("button", { name: /Market/ }).first().click();
  await p3.getByRole("menuitemradio").first().waitFor();
  await p3.screenshot({ path: join(SHOTS, "alerts-market-menu-375.png") });
  await p3.getByRole("menuitemradio").first().click();
  // Dark theme: the same menu in the dark tokens.
  await p3.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p3.getByRole("button", { name: /Market/ }).first().click();
  await p3.getByRole("menuitemradio").first().waitFor();
  const darkBackground = await p3.getByRole("menu").evaluate((el) => getComputedStyle(el).backgroundColor);
  check("dark theme: the market menu is dark, not white", darkBackground === "rgb(28, 28, 27)", darkBackground);
  await p3.screenshot({ path: join(SHOTS, "alerts-market-menu-dark-375.png") });
  await p3.getByRole("menuitemradio").first().click();
  await p3.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await p3.getByRole("button", { name: /^Price alerts/ }).click();
  await p3.getByRole("menuitem").first().waitFor();
  await p3.screenshot({ path: join(SHOTS, "alerts-bell-375.png") });
  const box = await p3.getByRole("menu").boundingBox();
  check("375 px: the bell menu stays on screen", box && box.x >= 0 && box.x + box.width <= 375, JSON.stringify(box));
  await phone.close();
  // ---- 6. The "Set alert" chip in the terminal header carries the market to the form ---------------------------------
  const term = await openContext(1440, 900);
  const p4 = await term.newPage();
  await p4.goto("/perpetuals");
  const chip = p4.getByRole("link", { name: "Set alert" });
  await chip.waitFor({ timeout: 60_000 });
  await p4.screenshot({ path: join(SHOTS, "alerts-set-alert-chip-1440.png") });
  const href = await chip.getAttribute("href");
  await chip.click();
  await p4.waitForURL(/\/alerts\?symbol=/);
  await connect(p4);
  await p4.getByText("New alert").first().waitFor();
  const chosen = ((await p4.locator("#alert-market-value").textContent()) ?? "").replace("-PERP", "");
  check("the Set alert chip opens the form on that market", href === `/alerts?symbol=${chosen}`, `${href} -> ${chosen}`);
  await term.close();
} finally {
  await chrome.close();
  pushServer.close();
  await sql.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
