// Browser proof of Ask Zeno (the "Ask Zeno" sheet). Two modes, one script.
//
//   MODE=states  (default) The API answer is scripted in the browser, so every state of the sheet can be shown without
//                a key: empty, loading, success with sources, error, busy, rate limit, daily limit, switched off.
//   MODE=real    The question goes to the real API (and its real model, with the key that is in the API's own
//                environment). Needs the API to run with AI_DEBUG=true, which adds the tool payloads to the answer, so
//                the script can check every number in the answer against them. Remove AI_DEBUG afterwards.
//
//   PLAYWRIGHT_DIR=~/.npm/_npx/<hash>   (a directory with node_modules/playwright)
//   WEB_URL=http://127.0.0.1:3000       (local web dev server, see docs/AI_ASSISTANT.md)
//   API_URL=https://<testnet api>       (MODE=real only; the browser reaches it through the test, so CORS does not matter)
//   node scripts/e2e-ai.mjs [screens-dir]
//
// Exit code 1 if any check fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? "", "/"))("playwright");
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const MODE = process.env.MODE ?? "states";
const API = process.env.API_URL;
const SHOTS = process.argv[2] ?? join(root, "docs/evidence/screens");
const QUESTION = process.env.QUESTION ?? "Why is NVDA down today?";
mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

/// Every number in a text, as values. "1,234.50" is 1234.5 (a comma before exactly three digits is a thousands comma) and
/// "3,42" is 3.42 (an Indonesian decimal comma). "05" is 5.
export const numbersIn = (text) =>
  [...text.matchAll(/\d+(?:,\d{3})*(?:[.,]\d+)?/g)].map((match) => {
    const raw = match[0];
    return Number(/,\d{3}(?!\d)/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", "."));
  });

/// A timestamp is read as its parts (year, month, day, hour, minute, second), so a model may write "17:58" for
/// "17:58:25.349Z" without that counting as a new number.
const ISO = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?/g;

/// Numbers in the answer that no tool payload contains. Empty means every figure came from the data.
export function foreignNumbers(answer, payloads) {
  const text = JSON.stringify(payloads);
  const known = new Set(numbersIn(text.replace(ISO, " ")));
  for (const stamp of text.matchAll(ISO)) for (const part of stamp.slice(1)) known.add(Number(part));
  return [...new Set(numbersIn(answer))].filter((value) => !known.has(value));
}

const SOURCES = [
  { tool: "get_market_snapshot", source: "ZENOMARKETS oracle and indexer", asOf: "2026-10-14T14:05:00.000Z" },
  { tool: "get_news", source: "Publisher RSS feeds via ZENOMARKETS News", asOf: "2026-10-14T13:55:00.000Z" },
];

const reply = (status, body, headers = {}) => ({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

async function open(browser, size, name) {
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  await page.goto(`${WEB}/perpetuals?market=NVDA`, { waitUntil: "domcontentloaded" });
  const chip = page.getByRole("button", { name: "Ask Zeno" });
  await chip.waitFor({ timeout: 60_000 });
  // The button is in the server-rendered page, so a click before React attaches does nothing: wait for hydration.
  await chip.evaluate((el) => new Promise((resolve) => { const t = setInterval(() => { if (Object.keys(el).some((key) => key.startsWith("__reactProps"))) { clearInterval(t); resolve(); } }, 50); }));
  return { context, page, chip, name };
}

const shot = (page, state, width) => page.screenshot({ path: join(SHOTS, `ai-${state}-${width}.png`) });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

async function ask(page, text) {
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
}

async function states(browser, size) {
  const width = size.width;
  const { context, page, chip } = await open(browser, size);
  let release;
  let next = () => reply(200, { answer: "NVDA is down 3.12% over 24 hours (ZENOMARKETS oracle).\nRisk: prices can move fast and you can lose your collateral.", sources: SOURCES });
  await page.route("**/v1/ai/chat", async (route) => {
    await new Promise((resolve) => (release = resolve));
    await route.fulfill(next());
  });

  const look = () => page.evaluate(() => { const el = document.querySelector('[role="dialog"]'); const css = el && getComputedStyle(el); return css ? `${css.translate} ${css.opacity}` : "none"; });
  await chip.click();
  const dialog = page.getByRole("dialog", { name: "Zeno" });
  await dialog.waitFor();
  await page.waitForTimeout(70);
  const midway = await look();
  await page.waitForTimeout(450);
  const settled = await look();
  check(`${width}: the sheet opens with a slide, not a jump (200 ms)`, midway !== settled && (await dialog.evaluate((el) => getComputedStyle(el).transitionDuration)) === "0.2s", `${midway} then ${settled}`);
  await dialog.getByText("Reading NVDA-PERP").waitFor({ timeout: 60_000 });
  check(`${width}: sheet opens, focus moves into it`, await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null));
  check(`${width}: empty state shows three suggested questions`, (await dialog.getByRole("button", { name: /NVDA|funding rate/i }).count()) >= 3);
  check(`${width}: Zeno introduces itself`, (await dialog.getByText("Hello, I'm Zeno").first().isVisible()) && (await dialog.getByText("What can I do for you").first().isVisible()));
  check(`${width}: disclaimer is on screen`, await dialog.getByText("Zeno can make mistakes, not financial advice").isVisible());
  check(`${width}: no horizontal scroll (empty)`, await noSideScroll(page));
  await shot(page, "empty", width);

  await dialog.getByRole("button", { name: "Why is NVDA moving today?" }).click();
  await dialog.getByRole("status").waitFor();
  check(`${width}: loading row while waiting`, await dialog.getByText("Zeno is reading the market").isVisible());
  await shot(page, "loading", width);
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await dialog.getByText("NVDA is down 3.12%").waitFor();
  check(`${width}: answer appears whole, with sources and times`, (await dialog.getByText(/ZENOMARKETS oracle and indexer · 14:05 UTC, 14 Oct/).count()) === 1);
  check(`${width}: no horizontal scroll (answer)`, await noSideScroll(page));
  await shot(page, "success", width);

  for (const [state, response, expected] of [
    ["error", reply(502, { code: "unavailable", error: "raw provider words" }), /could not answer right now/],
    ["busy", reply(503, { code: "busy", error: "x", retryAfterSeconds: 30 }, { "retry-after": "30" }), /busy.*right now.*30 seconds/],
    ["rate", reply(429, { code: "rate_limited", error: "x", retryAfterSeconds: 15 }), /asking too fast/],
    ["daily", reply(429, { code: "daily_limit", error: "x", retryAfterSeconds: 3600 }), /limit for today/],
  ]) {
    next = () => response;
    await ask(page, `second question ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await dialog.getByRole("alert").waitFor();
    const text = await dialog.getByRole("alert").innerText();
    check(`${width}: ${state} says what happened in plain words`, expected.test(text) && !/raw provider|429|503|502/.test(text), text.replace(/\n/g, " | "));
    if (state === "daily") check(`${width}: daily limit disables the input`, await page.getByLabel("Your question").isDisabled());
    await shot(page, state, width);
    if (state !== "daily") await dialog.getByRole("button", { name: "Try again" }).waitFor();
  }

  if (width <= 400) {
    const heights = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button:not([tabindex="-1"]), [role="dialog"] input')].filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().height)));
    check("375: every button and the input in the sheet are at least 44 px high", heights.every((height) => height >= 44), heights.join(","));
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  check(`${width}: Escape closes the sheet and focus returns to the chip`, await chip.evaluate((el) => el === document.activeElement));
  await context.close();
}

async function real(browser, size) {
  const width = size.width;
  const { context, page, chip } = await open(browser, size);
  let captured;
  await page.route("**/v1/ai/chat", async (route) => {
    // The test makes the call, so the browser's CORS rules do not apply to this one request.
    const response = await route.fetch({ url: `${API.replace(/\/$/, "")}/v1/ai/chat` });
    captured = { status: response.status(), body: await response.json().catch(() => null) };
    await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
  });
  await chip.click();
  const dialog = page.getByRole("dialog", { name: "Zeno" });
  await dialog.getByText("Reading NVDA-PERP").waitFor({ timeout: 60_000 });
  await ask(page, QUESTION);
  await dialog.getByRole("status").waitFor();
  await shot(page, "real-loading", width);
  await page.waitForResponse((response) => response.url().includes("/v1/ai/chat"), { timeout: 40_000 });
  await dialog.locator("ul li").first().waitFor({ timeout: 40_000 }).catch(() => {});
  await shot(page, "real-answer", width);

  check(`${width}: real API answered 200`, captured?.status === 200, `status ${captured?.status} ${captured?.body?.code ?? ""}`);
  if (captured?.status !== 200) return;
  const { answer, sources, debug } = captured.body;
  const shown = await dialog.locator("ul li").allInnerTexts();
  check(`${width}: answer cites sources with timestamps`, sources.length > 0 && shown.length === sources.length && shown.every((line) => /UTC, \d{1,2} \w{3}$/.test(line)), shown.join(" | "));
  check(`${width}: answer ends with a risk line`, /(^|\n)(Risk|Risiko):/i.test(answer.trim().split("\n").pop()));
  check(`${width}: tool payloads were returned (server has AI_DEBUG=true)`, Array.isArray(debug?.payloads) && debug.payloads.length > 0);
  if (Array.isArray(debug?.payloads)) {
    const foreign = foreignNumbers(answer, debug.payloads);
    check(`${width}: every number in the answer is in a tool payload`, foreign.length === 0, foreign.length ? `not in payloads: ${foreign.join(", ")}` : `${numbersIn(answer).length} numbers checked`);
  }
  check(`${width}: no horizontal scroll`, await noSideScroll(page));
  writeFileSync(join(SHOTS, `ai-real-${width}.json`), JSON.stringify({ question: QUESTION, answer, sources, tools: debug?.payloads?.map((p) => p.source) }, null, 2));
  console.log(`\nQUESTION: ${QUESTION}\nANSWER:\n${answer}\n`);
  await context.close();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const browser = await chromium.launch();
  for (const size of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) await (MODE === "real" ? real : states)(browser, size);
  await browser.close();
  console.log(failed === 0 ? "\nALL CHECKS PASS" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
