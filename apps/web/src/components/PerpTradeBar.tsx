"use client";

import { Button } from "@zeno/ui";
import { usePerpMarketConfig } from "@/hooks/queries";
import { tradeBlocker } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { useOpenTradeSheet } from "./TradeSheet";

/// Phone-only shortcut to the order panel: picks the side and opens the sheet. A paused market
/// refuses the trade here too — the order panel behind the sheet already says so, but a live Long
/// button that opens a ticket which cannot be submitted is the wrong first answer.
export function PerpTradeBar() {
  const open = useOpenTradeSheet();
  const symbol = useTerminal((state) => state.symbol);
  const setSide = useTerminal((state) => state.setSide);
  const paused = tradeBlocker(usePerpMarketConfig(symbol)?.active);

  if (paused) {
    return (
      <Button variant="secondary" className="flex-1" disabled>
        Market paused
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="up"
        className="flex-1"
        onClick={() => {
          setSide("LONG");
          open();
        }}
      >
        Long
      </Button>
      <Button
        variant="down"
        className="flex-1"
        onClick={() => {
          setSide("SHORT");
          open();
        }}
      >
        Short
      </Button>
    </>
  );
}
