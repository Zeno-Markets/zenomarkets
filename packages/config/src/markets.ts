import {
  isListingTier,
  isMarketGroup,
  LISTING_TIERS,
  MARKET_GROUPS,
  tierNeedsFeed,
  type Address,
  type ListingTier,
  type MarketGroup,
} from "@zeno/types";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, type ChainId } from "./chains.js";

/// One row of `packages/contracts/deployments/<network>.markets.json`, which is the source of the
/// market list for the contracts listing script, the services and the web app alike. `group` and
/// `tier` live in that file and are read through here, so regrouping a market or promoting it between
/// tiers is a data change — no app code holds a group or a tier as a literal.
export interface MarketListing {
  /// Ticker, and the on-chain market id: `ZenoMarketRegistry` keys a market by `bytes32(bytes(symbol))`.
  symbol: string;
  name: string;
  /// The tokenized asset. `ZenoMarketRegistry.addMarket` checks it is non-zero and then never reads it
  /// again (`REFERENCE.md` Section 2 Finding 5), so it is the asset's identity, not a settlement path.
  /// Required for a `tradeable` listing. A display-only row for a stock that has no token on this chain
  /// (the China names such as PDD and JD) has none.
  token?: Address;
  /// The Chainlink feed. **Present if and only if `tier` is `tradeable`** — see `assertTierInvariant`.
  feed?: Address;
  maxLeverage: number;
  maintenanceBps: number;
  group: MarketGroup;
  tier: ListingTier;
  /// An https address of the asset's logo (CoinGecko for a coin, a ticker-logo CDN for a stock or ETF; Robinhood's own
  /// token logos are one generic mark for every asset, so they are not used). The page falls back to the ticker's initials if it fails.
  logo?: string;
  /// The ticker the chart's past candles are read under, when it is not `symbol` (a coin: `BTC` is a fund on the
  /// stock exchanges, the coin is `BTC-USD`). Display only.
  historySymbol?: string;
}

/// The tier boundary, in one function. A `tradeable` listing settles on chain and must have a feed; a
/// `quoted` or `listed` one is display only and must have none, so a DexScreener or reference price can
/// never be mistaken for a settlement price. Asserted in both directions on every listing this package
/// hands out, at module load, because a silently mis-tagged row is exactly the failure that would let a
/// display price reach `ZenoPriceValidator`.
export function assertTierInvariant(listing: Pick<MarketListing, "symbol" | "tier" | "feed"> & { token?: Address }): void {
  const { symbol, tier, feed, token } = listing;
  if (!isListingTier(tier)) {
    throw new Error(`@zeno/config: market ${symbol} has unknown tier "${String(tier)}" (expected one of ${LISTING_TIERS.join(", ")})`);
  }
  if (tierNeedsFeed(tier) && !feed) {
    throw new Error(`@zeno/config: market ${symbol} is tier "${tier}" but has no feed address; a tradeable market settles on chain and needs a price feed`);
  }
  if (tierNeedsFeed(tier) && !token) {
    throw new Error(`@zeno/config: market ${symbol} is tier "${tier}" but has no token address; a tradeable market lists a tokenized asset`);
  }
  if (!tierNeedsFeed(tier) && feed) {
    throw new Error(`@zeno/config: market ${symbol} is tier "${tier}" but carries feed ${feed}; a display-only tier must have no feed, or its price could reach settlement`);
  }
}

function assertListing(listing: MarketListing): MarketListing {
  if (!isMarketGroup(listing.group)) {
    throw new Error(`@zeno/config: market ${listing.symbol} has unknown group "${String(listing.group)}" (expected one of ${MARKET_GROUPS.join(", ")})`);
  }
  assertTierInvariant(listing);
  return listing;
}

/// Validates a whole list and returns it. Duplicate symbols are rejected too: the symbol is the
/// on-chain market id, so two rows sharing one would address the same market.
export function validateMarkets(listings: readonly MarketListing[]): readonly MarketListing[] {
  const seen = new Set<string>();
  for (const listing of listings) {
    assertListing(listing);
    if (seen.has(listing.symbol)) {
      throw new Error(`@zeno/config: market ${listing.symbol} is listed twice; the symbol is the on-chain market id`);
    }
    seen.add(listing.symbol);
  }
  return listings;
}

/// Mirrors `packages/contracts/deployments/robinhood_mainnet.markets.json`, the same checked-in-literal
/// arrangement as the addresses above it: regenerate with `pnpm --filter @zeno/config sync:markets`
/// after editing that file, and `markets.test.ts` fails if the two ever drift.
///
/// The first 39 are `tradeable`. The 35 equities are not a shortlist — `REFERENCE.md` Section 2 Finding 1 measured
/// that only 33 of the 194 tokenized assets on this chain have a Chainlink feed at all; DELL, USAR and SGOV got one
/// later. The seven US names at the end (NFLX, AVGO, CRM, COST, BA, ADBE, QCOM) are tokenized but have no feed yet, so
/// they are `quoted` until Chainlink publishes one. Ten China names (TCEHY to CQQQ) are quoted with no token at all. Groups are display only: `china` (BABA, TSM, EWY), `commodities`
/// (SLV, USO) and `etf` (SPY, QQQ, SGOV) regroup markets that already trade, and the rest are `us-equities`. The `crypto` group
/// (BTC, ETH, LINK, GLD) is feed-only: a perp needs only a feed (Finding 5), and these stay fresh at any hour.
const robinhoodMainnetMarkets: readonly MarketListing[] = [
  { symbol: "NVDA", name: "NVIDIA • Robinhood Token", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/NVDA.png" },
  { symbol: "AAPL", name: "Apple • Robinhood Token", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/AAPL.png" },
  { symbol: "TSLA", name: "Tesla • Robinhood Token", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/TSLA.png" },
  { symbol: "MSFT", name: "Microsoft • Robinhood Token", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/MSFT.png" },
  { symbol: "GOOGL", name: "Alphabet Class A • Robinhood Token", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/GOOGL.png" },
  { symbol: "AMZN", name: "Amazon • Robinhood Token", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/AMZN.png" },
  { symbol: "META", name: "Meta Platforms • Robinhood Token", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/META.png" },
  { symbol: "COIN", name: "Coinbase • Robinhood Token", token: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/COIN.png" },
  { symbol: "MSTR", name: "Strategy Inc. • Robinhood Token", token: "0xec262a75e413fAfD0dF80480274532C79D42da09", feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/MSTR.png" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust • Robinhood Token", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A", maxLeverage: 10, maintenanceBps: 500, group: "etf", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/SPY.png" },
  { symbol: "QQQ", name: "Invesco QQQ • Robinhood Token", token: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae", maxLeverage: 10, maintenanceBps: 500, group: "etf", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/QQQ.png" },
  { symbol: "AMD", name: "AMD • Robinhood Token", token: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/AMD.png" },
  { symbol: "ASML", name: "ASML Holding NV • Robinhood Token", token: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA", feed: "0xB4106147E8cce40b7d46124090d373A71b70f87D", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/ASML.png" },
  { symbol: "BABA", name: "Alibaba • Robinhood Token", token: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4", feed: "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984", maxLeverage: 5, maintenanceBps: 750, group: "china", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/BABA.png" },
  { symbol: "CLSK", name: "CleanSpark • Robinhood Token", token: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3", feed: "0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/CLSK.png" },
  { symbol: "CRCL", name: "Circle Internet Group • Robinhood Token", token: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/CRCL.png" },
  { symbol: "CRWV", name: "CoreWeave • Robinhood Token", token: "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3", feed: "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/CRWV.png" },
  { symbol: "EWY", name: "iShares MSCI South Korea fund • Robinhood Token", token: "0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc", feed: "0xEFdf54610B62A7753Ec30bDc380847c12D32e1D1", maxLeverage: 5, maintenanceBps: 750, group: "china", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/EWY.png" },
  { symbol: "GME", name: "GameStop • Robinhood Token", token: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/GME.png" },
  { symbol: "INTC", name: "Intel • Robinhood Token", token: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/INTC.png" },
  { symbol: "IONQ", name: "IonQ • Robinhood Token", token: "0x558378E000D634A36593E338eBacdd6207640EfE", feed: "0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/IONQ.png" },
  { symbol: "MU", name: "Micron Technology • Robinhood Token", token: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/MU.png" },
  { symbol: "NBIS", name: "Nebius Group • Robinhood Token", token: "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931", feed: "0xE1D87B116Ba0fe898998f1D140339D1fA1E09705", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/NBIS.png" },
  { symbol: "ORCL", name: "Oracle • Robinhood Token", token: "0xb0992820E760d836549ba69BC7598b4af75dEE03", feed: "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/ORCL.png" },
  { symbol: "PLTR", name: "Palantir Technologies • Robinhood Token", token: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", feed: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/PLTR.png" },
  { symbol: "RGTI", name: "Rigetti Computing • Robinhood Token", token: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba", feed: "0x2A045cF1C49c61c166C036d2f06FA2D2d984f765", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/RGTI.png" },
  { symbol: "RKLB", name: "Rocket Lab Corporation • Robinhood Token", token: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2", feed: "0x045477BF65Aef6f4F2386ad0164579e48381CC74", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/RKLB.png" },
  { symbol: "SLV", name: "iShares Silver Trust • Robinhood Token", token: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", feed: "0x209b73908e92Ae021826eD79609845451Ecba2ce", maxLeverage: 5, maintenanceBps: 750, group: "commodities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/SLV.png" },
  { symbol: "SNDK", name: "Sandisk Corporation • Robinhood Token", token: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/SNDK.png" },
  { symbol: "SPCX", name: "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token", token: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/SPCX.png" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing • Robinhood Token", token: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F", maxLeverage: 5, maintenanceBps: 750, group: "china", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/TSM.png" },
  { symbol: "USO", name: "United States Oil Fund • Robinhood Token", token: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c", maxLeverage: 5, maintenanceBps: 750, group: "commodities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/USO.png" },
  { symbol: "BTC", name: "Bitcoin", token: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251", feed: "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251", maxLeverage: 5, maintenanceBps: 750, group: "crypto", tier: "tradeable", logo: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png", historySymbol: "BTC-USD" },
  { symbol: "ETH", name: "Ether", token: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", feed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", maxLeverage: 5, maintenanceBps: 750, group: "crypto", tier: "tradeable", logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png", historySymbol: "ETH-USD" },
  { symbol: "LINK", name: "Chainlink", token: "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9", feed: "0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9", maxLeverage: 5, maintenanceBps: 750, group: "crypto", tier: "tradeable", logo: "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png", historySymbol: "LINK-USD" },
  { symbol: "GLD", name: "SPDR Gold Trust • Robinhood Token", token: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", feed: "0x470A51258068043bd43dC0a56245625C9fE86eB0", maxLeverage: 5, maintenanceBps: 750, group: "commodities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/GLD.png" },
  { symbol: "DELL", name: "Dell • Robinhood Token", token: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", feed: "0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b", maxLeverage: 5, maintenanceBps: 750, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/DELL.png" },
  { symbol: "USAR", name: "USA Rare Earth • Robinhood Token", token: "0xd917B029C761D264c6A312BBbcDA868658eF86a6", feed: "0xA994d3684e8400A6c8078226925779FdeE682DD9", maxLeverage: 3, maintenanceBps: 1000, group: "us-equities", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/USAR.png" },
  { symbol: "SGOV", name: "iShares 0-3 Month Treasury Bond • Robinhood Token", token: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", maxLeverage: 5, maintenanceBps: 750, group: "etf", tier: "tradeable", logo: "https://financialmodelingprep.com/image-stock/SGOV.png" },
  { symbol: "UMC", name: "United Microelectronics • Robinhood Token", token: "0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/UMC.png" },
  { symbol: "FUTU", name: "Futu Holdings • Robinhood Token", token: "0xeB30663bDFf0622Ef4e4E5cBb4E975F19f33f51D", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/FUTU.png" },
  { symbol: "EWT", name: "iShares MSCI Taiwan Capped ETF • Robinhood Token", token: "0x1c690498150252222C275A5CEd69d3A6b1f52D5E", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/EWT.png" },
  { symbol: "SIMO", name: "Silicon Motion • Robinhood Token", token: "0x77E655E37F4d913fB9540e0d541D824171a60e81", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/SIMO.png" },
  { symbol: "PDD", name: "PDD Holdings", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/PDD.png" },
  { symbol: "JD", name: "JD.com", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/JD.png" },
  { symbol: "BIDU", name: "Baidu", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/BIDU.png" },
  { symbol: "NIO", name: "NIO", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/NIO.png" },
  { symbol: "XPEV", name: "XPeng", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/XPEV.png" },
  { symbol: "LI", name: "Li Auto", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/LI.png" },
  { symbol: "NTES", name: "NetEase", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/NTES.png" },
  { symbol: "BILI", name: "Bilibili", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/BILI.png" },
  { symbol: "TME", name: "Tencent Music Entertainment", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/TME.png" },
  { symbol: "YUMC", name: "Yum China Holdings", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/YUMC.png" },
  { symbol: "ZTO", name: "ZTO Express", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/ZTO.png" },
  { symbol: "TCOM", name: "Trip.com Group", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/TCOM.png" },
  { symbol: "BEKE", name: "KE Holdings", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/BEKE.png" },
  { symbol: "KWEB", name: "KraneShares CSI China Internet ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/KWEB.png" },
  { symbol: "FXI", name: "iShares China Large-Cap ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/FXI.png" },
  { symbol: "MCHI", name: "iShares MSCI China ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/MCHI.png" },
  { symbol: "ASHR", name: "Xtrackers Harvest CSI 300 China A-Shares ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/ASHR.png" },
  { symbol: "TCEHY", name: "Tencent Holdings", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/TCEHY.png" },
  { symbol: "XIACY", name: "Xiaomi", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/XIACY.png" },
  { symbol: "BYDDY", name: "BYD Company", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/BYDDY.png" },
  { symbol: "MPNGY", name: "Meituan", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/MPNGY.png" },
  { symbol: "LKNCY", name: "Luckin Coffee", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/LKNCY.png" },
  { symbol: "PONY", name: "Pony AI", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/PONY.png" },
  { symbol: "WB", name: "Weibo", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/WB.png" },
  { symbol: "IQ", name: "iQIYI", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/IQ.png" },
  { symbol: "EWH", name: "iShares MSCI Hong Kong ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/EWH.png" },
  { symbol: "CQQQ", name: "Invesco China Technology ETF", maxLeverage: 1, maintenanceBps: 750, group: "china", tier: "quoted", logo: "https://assets.parqet.com/logos/symbol/CQQQ?format=png" },
  { symbol: "NFLX", name: "Netflix • Robinhood Token", token: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/NFLX.png" },
  { symbol: "AVGO", name: "Broadcom • Robinhood Token", token: "0x156E175DD063a8cE274C50654eF40e0032b3fbcF", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/AVGO.png" },
  { symbol: "CRM", name: "Salesforce • Robinhood Token", token: "0xd95B44124e475743a7589e68F3D74008A5536D44", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/CRM.png" },
  { symbol: "COST", name: "Costco • Robinhood Token", token: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/COST.png" },
  { symbol: "BA", name: "Boeing • Robinhood Token", token: "0x4D21483a44Bf67a86b77E3dA301411880797D452", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://assets.parqet.com/logos/symbol/BA?format=png" },
  { symbol: "ADBE", name: "Adobe • Robinhood Token", token: "0x232B8ed6377BE97813853B0Ac104c4Cda8378d1B", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/ADBE.png" },
  { symbol: "QCOM", name: "Qualcomm • Robinhood Token", token: "0x0f17206447090e464C277571124dD2688E48AEA9", maxLeverage: 1, maintenanceBps: 750, group: "us-equities", tier: "quoted", logo: "https://financialmodelingprep.com/image-stock/QCOM.png" },
];

/// No market list is recorded for testnet: `deployments/robinhood_testnet.markets.json` does not
/// exist, because the testnet stack was listed with mock tokens and mock feeds by `AddMarket.s.sol`
/// rather than from a file. An empty list is the recorded answer for this chain, not a missing one —
/// `marketsForChain` still throws for a chain it has never heard of.
const robinhoodTestnetMarkets: readonly MarketListing[] = [];

export const markets: Record<ChainId, readonly MarketListing[]> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: validateMarkets(robinhoodTestnetMarkets),
  [ROBINHOOD_MAINNET_CHAIN_ID]: validateMarkets(robinhoodMainnetMarkets),
};

export function marketsForChain(chainId: ChainId): readonly MarketListing[] {
  const list = markets[chainId];
  if (!list) {
    throw new Error(`@zeno/config: no market list recorded for chain ${chainId}`);
  }
  return list;
}

/// Every market in a group, in file order. An unknown group is an error rather than an empty list: a
/// typo in a group name would otherwise render an empty page that looks like a chain problem. A group
/// that is known but has no markets yet  correctly returns `[]`.
export function marketsForGroup(chainId: ChainId, group: MarketGroup): readonly MarketListing[] {
  if (!isMarketGroup(group)) {
    throw new Error(`@zeno/config: unknown market group "${String(group)}" (expected one of ${MARKET_GROUPS.join(", ")})`);
  }
  return marketsForChain(chainId).filter((market) => market.group === group);
}

/// Every market in a tier, in file order. An unknown tier is an error, for the same reason as a group.
/// The tier invariant is re-asserted here, so a caller that asks for `tradeable` markets can rely on
/// every row it gets back having a feed.
export function marketsForTier(chainId: ChainId, tier: ListingTier): readonly MarketListing[] {
  if (!isListingTier(tier)) {
    throw new Error(`@zeno/config: unknown listing tier "${String(tier)}" (expected one of ${LISTING_TIERS.join(", ")})`);
  }
  const list = marketsForChain(chainId).filter((market) => market.tier === tier);
  for (const market of list) assertTierInvariant(market);
  return list;
}

/// One market by ticker. Absent is `undefined`, so a caller decides whether that is a 404 or a reason
/// to fall back; nothing here invents a market.
export function marketForSymbol(chainId: ChainId, symbol: string): MarketListing | undefined {
  return marketsForChain(chainId).find((market) => market.symbol === symbol);
}

/// The group a ticker is shown under. A group classifies the asset, not the chain, so a chain with no
/// recorded listing for the ticker (testnet, listed with mock tokens by `AddMarket.s.sol`) borrows the
/// mainnet listing's group for the same ticker. A ticker listed nowhere has no group: `undefined`.
export function groupForSymbol(chainId: ChainId, symbol: string): MarketGroup | undefined {
  return (marketForSymbol(chainId, symbol) ?? marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol))?.group;
}

/// The feed address of a tradeable market. Throws for any other tier, which is the read path's half of
/// the tier boundary: there is no way to ask a quoted market for a settlement price.
export function feedForSymbol(chainId: ChainId, symbol: string): Address {
  const market = marketForSymbol(chainId, symbol);
  if (!market) throw new Error(`@zeno/config: no market "${symbol}" on chain ${chainId}`);
  assertTierInvariant(market);
  if (!tierNeedsFeed(market.tier) || !market.feed) {
    throw new Error(`@zeno/config: market ${symbol} is tier "${market.tier}" and has no settlement feed`);
  }
  return market.feed;
}

/// The logo of a listed symbol. Logos are the same on every network, so they come from the mainnet list (the
/// testnet has no recorded list); `undefined` when the symbol has none.
export function logoForSymbol(symbol: string): string | undefined {
  return markets[ROBINHOOD_MAINNET_CHAIN_ID].find((listing) => listing.symbol === symbol.toUpperCase())?.logo;
}
