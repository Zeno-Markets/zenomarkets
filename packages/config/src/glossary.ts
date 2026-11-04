/// Plain-language meanings for the terms a first-time trader meets. Each is one or two sentences with
/// no numbers in them: limits, fees and rates come from the chain and are shown beside the term, never
/// written here.
export type TermKey =
  | "liquidationPrice"
  | "fundingRate"
  | "openInterest"
  | "healthFactor"
  | "marginMode"
  | "crossLiquidation"
  | "worstPrice"
  | "breakEven"
  | "maxLoss"
  | "iv"
  | "delta"
  | "gamma"
  | "theta"
  | "vega";

export const GLOSSARY: Record<TermKey, { title: string; text: string }> = {
  liquidationPrice: {
    title: "Liquidation price",
    text: "If the market price reaches this, your position is closed automatically and you lose the collateral you put in. The closer it is to the current price, the riskier the position.",
  },
  fundingRate: {
    title: "Funding rate",
    text: "A small payment passed between longs and shorts to keep the perpetual price close to the real stock price. The side that pushes the price away pays the other side.",
  },
  openInterest: {
    title: "Open interest",
    text: "The total size of positions that are open right now on this market, in dollars. It shows how much money is at work, not which way the price will go.",
  },
  healthFactor: {
    title: "Health factor",
    text: "How safe your loan is. Above 1.00x it is safe; at 1.00x or below anyone can repay part of the loan and take your collateral. Higher is safer.",
  },
  marginMode: {
    title: "Isolated and cross margin",
    text: "Isolated: a position is backed only by the collateral you gave it, so that is all it can lose. Cross: it is backed by your whole account, so one bad position can use up more of your balance.",
  },
  crossLiquidation: {
    title: "Cross position",
    text: "A cross position has no price of its own. It is closed when the whole account's equity falls under what the account must hold.",
  },
  worstPrice: {
    title: "Worst accepted price",
    text: "The least favourable price your order will fill at. If the market moves past it before the order fills, the order is refused instead of filling at a worse price.",
  },
  breakEven: {
    title: "Break-even",
    text: "The price the stock must reach at expiry for the option to repay what you paid for it. Past it you profit; short of it you lose.",
  },
  maxLoss: {
    title: "Maximum loss",
    text: "The most you can lose on this option. For a bought option it is what you paid, premium and fee included.",
  },
  iv: {
    title: "Implied volatility (IV)",
    text: "How much movement the option's price assumes. Higher IV makes options cost more.",
  },
  delta: {
    title: "Delta",
    text: "How much the option's price moves when the stock moves by one dollar. Near 1 behaves like the stock; near 0 barely moves.",
  },
  gamma: {
    title: "Gamma",
    text: "How fast delta itself changes as the stock moves. High gamma means the option's behaviour shifts quickly near its strike.",
  },
  theta: {
    title: "Theta",
    text: "How much value the option loses each day just from time passing, with the stock unchanged.",
  },
  vega: {
    title: "Vega",
    text: "How much the option's price changes when implied volatility moves by one point.",
  },
};
