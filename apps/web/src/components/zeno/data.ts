"use client";

import { marketForSymbol, marketsForChain, ROBINHOOD_MAINNET_CHAIN_ID } from "@zeno/config";
import { useQuery } from "@tanstack/react-query";
import type { Spark } from "@/app/api/spark/route";
import { useAllMarkets } from "@/hooks/queries";
import { symbolOf } from "@/lib/market";

export type AssetClass = "stock" | "etf" | "crypto" | "commodity";

export const CLASS_LABEL: Record<AssetClass, string> = { stock: "Stock", etf: "ETF", crypto: "Crypto", commodity: "Commodity" };
/// The tab and chip names. Not `${CLASS_LABEL[c]}s`: that spelled "Commoditys".
export const CLASS_PLURAL: Record<AssetClass, string> = { stock: "Stocks", etf: "ETFs", crypto: "Cryptos", commodity: "Commodities" };
export const CLASS_ORDER: AssetClass[] = ["stock", "etf", "crypto", "commodity"];

export interface CardMarket {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  maxLeverage: number;
}

function classOf(symbol: string): AssetClass {
  const group = marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol)?.group;
  return group === "etf" ? "etf" : group === "crypto" ? "crypto" : group === "commodities" ? "commodity" : "stock";
}

/// The listing's display name without the token suffix ("NVIDIA • Robinhood Token" -> "NVIDIA").
function nameOf(symbol: string): string {
  return (marketForSymbol(ROBINHOOD_MAINNET_CHAIN_ID, symbol)?.name ?? symbol).split(" • ")[0]!;
}

/// The markets listed on this network's registry, in the landing page's shape. Until the registry answers, the
/// tradeable listing stands in, so the hero never renders empty.
export function useCardMarkets(): CardMarket[] {
  const { data } = useAllMarkets();
  if (data && data.length > 0) {
    return data
      .filter((market) => market.active && market.perpsEnabled)
      .map((market) => {
        const symbol = symbolOf(market.marketId);
        return { symbol, name: nameOf(symbol), assetClass: classOf(symbol), maxLeverage: Number(market.maxLeverage) };
      });
  }
  return marketsForChain(ROBINHOOD_MAINNET_CHAIN_ID)
    .filter((market) => market.tier === "tradeable")
    .slice(0, 20)
    .map((market) => ({ symbol: market.symbol, name: nameOf(market.symbol), assetClass: classOf(market.symbol), maxLeverage: market.maxLeverage }));
}

export function useSparks() {
  return useQuery({
    queryKey: ["spark"],
    queryFn: async (): Promise<Record<string, Spark>> => {
      const response = await fetch("/api/spark");
      if (!response.ok) throw new Error("spark unavailable");
      return response.json();
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
