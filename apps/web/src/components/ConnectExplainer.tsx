"use client";

import { Button, Skeleton } from "@zeno/ui";
import { useEffect, useRef, useState } from "react";
import { usePerpMarket, usePerpMarkets, useSettlementDecimals } from "@/hooks/queries";
import { connectMessage, useWalletChoices, useWalletConnect } from "@/hooks/useWalletConnect";
import { fmtUsd } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { chain } from "@/lib/wagmi";
import { useConnectDialog } from "@/stores/connectDialog";
import { useModeStore } from "@/stores/mode";

/// The caps, read from the chain for the first listed market so the numbers are real rather than a
/// paragraph that goes stale. Each market has its own; the ticket shows the one it trades.
function Caps() {
  const { data: markets } = usePerpMarkets();
  const symbol = markets?.[0] ? symbolOf(markets[0].marketId) : "";
  const { data: market, isError } = usePerpMarket(symbol);
  const { data: decimals = 6 } = useSettlementDecimals();

  if (isError) return <>Each market has a position limit and an open-interest cap, shown on its order ticket.</>;
  if (!market) return <Skeleton className="w-48" />;
  return (
    <>
      Position limit {fmtUsd(market.risk.maxPositionNotional, decimals, 3)} per wallet and open-interest cap {fmtUsd(market.risk.openInterestCap, decimals, 3)} on {symbol}-PERP, up to{" "}
      {market.risk.maxLeverage.toString()}x leverage. Each market has its own, shown on its ticket. The launch caps are small on purpose.
    </>
  );
}

const items = (caps: React.ReactNode) =>
  [
    { title: "What a wallet does here", body: "Your wallet holds your USDG and signs each action. ZENO never holds your keys, and nothing moves until you approve it in your wallet." },
    { title: "The caps", body: caps },
  ] as const;

/// The one-screen explainer, shown once at the moment a person chooses to connect. It is a dialog rather
/// than a page so declining stays one click away: "Not now" is as easy as "Continue".
export function ConnectExplainer() {
  const open = useConnectDialog((state) => state.open);
  const hide = useConnectDialog((state) => state.hide);
  const markSeen = useModeStore((state) => state.markExplainerSeen);
  const { isPending, error, reset, connectWith } = useWalletConnect();
  const choices = useWalletChoices();
  const [picking, setPicking] = useState(false);
  const actions = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    actions.current?.querySelector("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;

  const done = () => {
    markSeen();
    setPicking(false);
    reset();
    hide();
  };
  const proceed = () => {
    reset();
    if (choices.length === 1) connectWith(choices[0]!, done, () => undefined);
    else setPicking(true);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ground/85 sm:items-center sm:p-6" onPointerDown={(event) => event.target === event.currentTarget && hide()}>
      <div role="dialog" aria-modal="true" aria-labelledby="connect-title" className="max-h-dvh w-full overflow-y-auto rounded-t-panel border border-line bg-surface p-5 sm:max-w-lg sm:rounded-panel sm:p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Before you connect</p>
        <h2 id="connect-title" className="mt-1 text-title font-normal">
          Connect a wallet to {chain.name}
        </h2>
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {items(<Caps />).map((item, index) => (
            <li key={item.title} className="flex gap-3 py-3">
              <span className="w-5 shrink-0 text-xs tabular-nums text-faint">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-0.5 text-sm leading-snug text-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {error ? (
          <p role="alert" className="mt-4 text-sm leading-snug text-down">
            {connectMessage(error)}
          </p>
        ) : null}
        {picking && choices.length > 1 ? (
          <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Choose a wallet">
            {choices.map((connector) => (
              <Button key={connector.uid} disabled={isPending} onClick={() => connectWith(connector, done)}>
                {connector.name}
              </Button>
            ))}
          </div>
        ) : null}

        <div ref={actions} className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={hide}>
            Not now
          </Button>
          <Button variant="primary" disabled={isPending} onClick={proceed}>
            {isPending ? "Connecting…" : "Continue to wallet"}
          </Button>
        </div>
      </div>
    </div>
  );
}
