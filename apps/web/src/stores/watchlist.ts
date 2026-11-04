import { create } from "zustand";
import { env } from "@/lib/env";

/// The markets this browser pinned, kept per network because the two registries list different markets.
/// Read in an effect (`load`), never at module scope, so the server render and the first client render agree.
const key = () => `zeno-watchlist-v1-${env.chainId}`;

interface WatchlistState {
  /// Market symbols in the order they were added.
  symbols: string[];
  /// False until storage has been read, so a pinned market does not flash an empty list.
  ready: boolean;
  load: () => void;
  toggle: (symbol: string) => void;
}

function write(symbols: string[]) {
  try {
    localStorage.setItem(key(), JSON.stringify(symbols));
  } catch {
    // Storage blocked: the list still works until the page closes.
  }
}

export const useWatchlist = create<WatchlistState>((set, get) => ({
  symbols: [],
  ready: false,
  load: () => {
    let symbols: string[] = [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key()) ?? "[]");
      if (Array.isArray(stored)) symbols = stored.filter((item): item is string => typeof item === "string");
    } catch {
      // Blocked or corrupt storage reads as an empty list.
    }
    set({ symbols, ready: true });
  },
  toggle: (symbol) => {
    const { symbols } = get();
    const next = symbols.includes(symbol) ? symbols.filter((item) => item !== symbol) : [...symbols, symbol];
    set({ symbols: next });
    write(next);
  },
}));
