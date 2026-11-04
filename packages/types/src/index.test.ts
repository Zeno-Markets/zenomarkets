import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISPLAY_ONLY_TIERS,
  isListingTier,
  isMarketGroup,
  LISTING_TIERS,
  MARKET_GROUPS,
  tierNeedsFeed,
  type ListingTier,
  type MarketGroup,
} from "./index.js";

test("the four market groups are exactly the ones the data may use", () => {
  assert.deepEqual([...MARKET_GROUPS], ["us-equities", "china", "commodities", "etf", "crypto"]);
});

test("the three listing tiers are exactly the REFERENCE.md Section 2 model", () => {
  assert.deepEqual([...LISTING_TIERS], ["tradeable", "quoted", "listed"]);
});

test("an unknown group or tier is rejected, never coerced", () => {
  for (const group of MARKET_GROUPS) assert.equal(isMarketGroup(group), true);
  for (const tier of LISTING_TIERS) assert.equal(isListingTier(tier), true);
  // Near misses: a plural, a different case, a legacy spelling, a non-string.
  for (const bad of ["us-equity", "US-EQUITIES", "equities", "ponz", "", undefined, null, 0, {}]) {
    assert.equal(isMarketGroup(bad), false, `isMarketGroup(${JSON.stringify(bad)})`);
  }
  for (const bad of ["tradable", "Tradeable", "quote", "", undefined, null, 0, {}]) {
    assert.equal(isListingTier(bad), false, `isListingTier(${JSON.stringify(bad)})`);
  }
});

test("only a tradeable tier needs a feed, and every other tier is display only", () => {
  assert.equal(tierNeedsFeed("tradeable"), true);
  const displayOnly: readonly ListingTier[] = DISPLAY_ONLY_TIERS;
  for (const tier of LISTING_TIERS) {
    assert.equal(tierNeedsFeed(tier), !displayOnly.includes(tier), tier);
  }
  // The two sets together are the whole model: nothing is both, nothing is neither.
  assert.equal(displayOnly.length + 1, LISTING_TIERS.length);
});

test("the group and tier types stay unions, so a typo fails typecheck", () => {
  const group: MarketGroup = "crypto";
  const tier: ListingTier = "quoted";
  // @ts-expect-error — "nasdaq" is not a MarketGroup
  const badGroup: MarketGroup = "nasdaq";
  // @ts-expect-error — "tradable" is a misspelling of "tradeable"
  const badTier: ListingTier = "tradable";
  assert.equal(isMarketGroup(group) && isListingTier(tier), true);
  assert.equal(isMarketGroup(badGroup) || isListingTier(badTier), false);
});
