import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKET_GROUPS } from "@zeno/types";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chains.js";
import { marketForSymbol } from "./markets.js";
import { NEWS_CATEGORIES, NEWS_FEEDS, categoryForGroup, tickerFeed } from "./news.js";

test("every market group maps to a news category", () => {
  for (const group of MARKET_GROUPS) {
    const category = categoryForGroup(group);
    assert.ok(category && NEWS_CATEGORIES.includes(category), group);
  }
  assert.equal(categoryForGroup("us-equities"), "stocks");
});

test("every category has at least two https feeds, none repeated", () => {
  for (const category of NEWS_CATEGORIES) assert.ok(NEWS_FEEDS.filter((feed) => feed.category === category).length >= 2, category);
  assert.ok(NEWS_FEEDS.every((feed) => feed.url.startsWith("https://")));
  assert.equal(new Set(NEWS_FEEDS.map((feed) => feed.url)).size, NEWS_FEEDS.length);
});

test("a ticker feed uses the history alias when the listing has one", () => {
  assert.match(tickerFeed(marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, "BTC")!)!.url, /[?&]s=BTC-USD&/);
  assert.match(tickerFeed(marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, "AAPL")!)!.url, /[?&]s=AAPL&/);
  assert.equal(tickerFeed(marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, "BABA")!)!.category, "china");
});
