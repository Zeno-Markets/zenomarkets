"use client";

import { alertLabel, alertMessage, fmtAlertPrice, parseAlertValue, type AlertKind } from "@zeno/sdk";
import { Button, Panel, ReviewStep, Segmented, Skeleton, TextField, cn, menuItem } from "@zeno/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { usePerpMarket, usePerpMarketConfig, usePerpMarkets } from "@/hooks/queries";
import { useDismiss } from "@/hooks/useDismiss";
import { useAlertList } from "@/hooks/useAlerts";
import { timeAgo, type AlertRow } from "@/lib/alerts";
import { post } from "@/lib/copy";
import { env } from "@/lib/env";
import { shortHash } from "@/lib/format";
import { symbolOf, tradeBlocker } from "@/lib/market";
import { hasPushSubscription, pushSupport, subscribeMessage, subscribeThisBrowser, type PushSupport } from "@/lib/push";
import { ConnectButton } from "./ConnectButton";
import { OnMainnet } from "./NetworkText";
import { PanelState } from "./PanelState";
import { NONE } from "./None";

type Mode = "reach" | "up" | "down";

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "reach", label: "Reaches $" },
  { value: "up", label: "Rises %" },
  { value: "down", label: "Falls %" },
];

/// How often the engine looks, in plain words. The testnet indexer runs as a five-minute cron job.
function Cadence() {
  return (
    <OnMainnet otherwise="On testnet, alerts are checked about every 5 minutes, so one can arrive a few minutes after the price moves.">
      Alerts are checked about once a minute, so one can arrive a little after the price moves.
    </OnMainnet>
  );
}

/// The market picker. A native `<select>` opens the browser's own white list, which ignores the theme, so this is a
/// menu in the NetworkMenu style: raised fill, hairline border, accent tint on hover and on the chosen market. It opens
/// in the flow of the form, because the panel clips anything that floats past its edge.
function MarketMenu({ symbols, value, onChange }: { symbols: string[]; value: string; onChange: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <span id="alert-market-label" className="mb-1 block text-xs text-muted">
        Market
      </span>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby="alert-market-label alert-market-value"
        onClick={() => setOpen((state) => !state)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-line bg-raised px-3 text-sm font-medium text-text transition-colors duration-150 hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg"
      >
        <span id="alert-market-value">{value ? `${value}-PERP` : "Choose a market"}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6" className={cn("h-1.5 w-2.5 shrink-0 fill-none stroke-current transition-transform duration-150", open && "rotate-180")} strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="mt-1 max-h-[min(16rem,50vh)] overflow-y-auto rounded-panel border border-line bg-raised py-1">
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              role="menuitemradio"
              aria-checked={symbol === value}
              className={cn(menuItem, "flex min-h-11 w-full items-center justify-between px-3 text-left text-sm", symbol === value && "bg-accent-soft font-medium")}
              onClick={() => {
                onChange(symbol);
                close();
              }}
            >
              {symbol}-PERP
              {symbol === value ? <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/// The form. Three kinds on screen, four in the API: "Reaches $X" becomes above or below by comparing X with the
/// price now, so the person never has to say which side. Review comes before the wallet is asked to sign.
function NewAlert({ wallet, initialSymbol }: { wallet: string; initialSymbol: string }) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const { data: markets } = usePerpMarkets();
  const [symbol, setSymbol] = useState(initialSymbol);
  const [mode, setMode] = useState<Mode>("reach");
  const [value, setValue] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean }>();

  useEffect(() => {
    if (!symbol && markets?.[0]) setSymbol(symbolOf(markets[0].marketId));
  }, [markets, symbol]);

  const { data: market, isPending } = usePerpMarket(symbol);
  const paused = tradeBlocker(usePerpMarketConfig(symbol)?.active);
  const price = market?.indexPrice;

  // What the form means, or the first thing wrong with it.
  const typed = value.trim();
  let kind: AlertKind | undefined;
  let target: string | undefined;
  let problem: string | undefined;
  if (typed !== "") {
    const asKind: AlertKind = mode === "up" ? "pct_up" : mode === "down" ? "pct_down" : "price_above";
    const parsed = parseAlertValue(asKind, typed);
    if ("error" in parsed) problem = parsed.error;
    else if (mode === "reach") {
      if (price === undefined) problem = "This market has no price right now, so there is nothing to compare with.";
      else if (BigInt(parsed.target) === price) problem = "That is the price now. Pick a different level.";
      else {
        kind = BigInt(parsed.target) > price ? "price_above" : "price_below";
        target = parsed.target;
      }
    } else {
      kind = asKind;
      target = parsed.target;
    }
  }
  const noPrice = price === undefined && !isPending;
  const ready = Boolean(kind && target && price !== undefined);

  async function submit() {
    if (!kind || !symbol) return;
    setBusy(true);
    setNote(undefined);
    try {
      const request = { action: "create", symbol, kind, value: typed } as const;
      const issuedAt = Math.floor(Date.now() / 1000);
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: alertMessage(wallet, request, issuedAt) });
      } catch {
        return setNote({ text: "The signature was not given, so the alert was not set.", ok: false });
      }
      const posted = await post("/v1/alerts", { wallet, symbol, kind, value: typed, issuedAt, signature });
      if (!posted.ok) return setNote({ text: posted.error, ok: false });
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      setReviewing(false);
      setValue("");
      setNote({ text: "Alert set. It fires once, then moves to the history.", ok: true });
    } finally {
      setBusy(false);
    }
  }

  const when = kind && target ? alertLabel(symbol, kind, target, price?.toString()) : "";

  if (reviewing && ready) {
    return (
      <div className="p-4">
        <ReviewStep
          title={`Set alert: ${when}`}
          rows={[
            { label: "Market", value: `${symbol}-PERP`, strong: true },
            { label: "Tell me when", value: when, strong: true },
            { label: "Price now", value: fmtAlertPrice(price!) },
            { label: "It fires", value: "Once. Then it moves to your history." },
            { label: "Cost", value: "Free. You sign a message, not a transaction." },
          ]}
          worstCase="An alert only tells you. It never trades for you. It can arrive late, and it will not fire while the market is closed or paused."
          note={
            <>
              <Cadence /> Your alerts are readable by anyone who knows your wallet address. They name a market and a price, never a balance.
            </>
          }
          busy={busy}
          confirmLabel="Sign and set alert"
          onBack={() => setReviewing(false)}
          onConfirm={submit}
        />
        {note && !note.ok ? <p className="mt-3 max-w-prose leading-snug text-down">{note.text}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <MarketMenu symbols={(markets ?? []).map((m) => symbolOf(m.marketId))} value={symbol} onChange={setSymbol} />
      <p className="text-sm text-muted" aria-live="polite">
        {paused ? "This market is paused. You can still set an alert; it waits until the market is back. " : ""}
        {price !== undefined ? `Price now ${fmtAlertPrice(price)}.` : isPending ? "Reading the price…" : noPrice ? "No price right now. Try again when the market is open." : ""}
      </p>
      <Segmented<Mode> label="Alert type" options={MODES} value={mode} onChange={setMode} />
      <TextField
        label={mode === "reach" ? "Price (USD)" : "Change (%)"}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          setNote(undefined);
        }}
        placeholder={mode === "reach" ? "200" : "5"}
        suffix={mode === "reach" ? "USD" : "%"}
        invalid={Boolean(problem)}
        hint={mode === "reach" ? undefined : "from the price now"}
      />
      {problem ? <p className="leading-snug text-down">{problem}</p> : null}
      {note ? <p className={cn("leading-snug", !note.ok && "text-down")}>{note.text}</p> : null}
      <Button variant="primary" disabled={!ready} onClick={() => setReviewing(true)}>
        Review
      </Button>
      <p className="text-xs leading-snug text-muted">
        <Cadence />
      </p>
    </div>
  );
}

/// Browser notifications. Nothing is registered until the button is pressed, and the worker, the permission prompt
/// and one signature all follow from that press.
function BrowserNotifications({ wallet }: { wallet: string }) {
  const { signMessageAsync } = useSignMessage();
  const [support, setSupport] = useState<PushSupport | "checking">("checking");
  const [enabled, setEnabled] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSupport(pushSupport());
    void hasPushSubscription().then(setEnabled);
  }, []);

  async function enable() {
    setBusy(true);
    setError(undefined);
    try {
      const subscription = await subscribeThisBrowser();
      const issuedAt = Math.floor(Date.now() / 1000);
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: subscribeMessage(wallet, subscription, issuedAt) });
      } catch {
        return setError("The signature was not given, so this browser was not added.");
      }
      const posted = await post("/v1/push/subscribe", { wallet, ...subscription, issuedAt, signature });
      if (!posted.ok) return setError(posted.error);
      setEnabled(true);
      setReviewing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Browser notifications could not be turned on.");
      setSupport(pushSupport());
    } finally {
      setBusy(false);
    }
  }

  const words: Partial<Record<PushSupport, string>> = {
    unsupported: "This browser cannot receive push notifications. Alerts still appear in the bell on this site.",
    "ios-install": "On iPhone and iPad, browser notifications work only for a web app added to the Home Screen. Tap Share, then Add to Home Screen, and open ZENO from there.",
    denied: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload this page.",
    "no-key": "Browser notifications are not set up on this site yet. Alerts still appear in the bell.",
  };

  if (support === "checking") return <div className="p-4"><Skeleton className="h-9 w-48" /></div>;
  if (support !== "ok") return <p className="p-4 leading-snug text-muted">{words[support]}</p>;
  if (enabled) return <p className="p-4 leading-snug">Browser notifications are on for this browser. You hear about a fired alert even when ZENO is closed.</p>;
  if (reviewing) {
    return (
      <div className="p-4">
        <ReviewStep
          title="Enable browser notifications"
          rows={[
            { label: "This browser", value: "Gets a notification when one of your alerts fires" },
            { label: "Linked to", value: shortHash(wallet) },
            { label: "Cost", value: "Free. You sign a message, not a transaction." },
          ]}
          worstCase="Your browser asks for permission first. If you say no, nothing is saved and alerts still appear in the bell."
          note="You can remove this browser any time in your browser's site settings."
          busy={busy}
          confirmLabel="Allow and sign"
          onBack={() => setReviewing(false)}
          onConfirm={enable}
        />
        {error ? <p className="mt-3 leading-snug text-down">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <p className="leading-snug text-muted">Get a notification on this device when an alert fires, even when ZENO is not open.</p>
      <Button variant="secondary" onClick={() => setReviewing(true)}>
        Enable browser notifications
      </Button>
      {error ? <p className="leading-snug text-down">{error}</p> : null}
    </div>
  );
}

function Rows() {
  return (
    <div aria-busy="true" aria-label="Loading your alerts">
      {[0, 1, 2].map((n) => (
        <div key={n} className="flex items-center gap-4 border-t border-line px-3 py-3 first:border-t-0">
          <Skeleton className="w-40" />
          <Skeleton className="ml-auto w-16" />
        </div>
      ))}
    </div>
  );
}

function ActiveRow({ alert, wallet }: { alert: AlertRow; wallet: string }) {
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      const issuedAt = Math.floor(Date.now() / 1000);
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: alertMessage(wallet, { action: "cancel", id: alert.id }, issuedAt) });
      } catch {
        return setError("The signature was not given, so the alert is still on.");
      }
      const posted = await post("/v1/alerts/cancel", { wallet, id: alert.id, issuedAt, signature });
      if (!posted.ok) return setError(posted.error);
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-3 py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="font-medium">{alertLabel(alert.symbol, alert.kind, alert.target, alert.basePrice)}</p>
        <p className="text-xs text-muted">
          Price was {fmtAlertPrice(alert.basePrice)} when set, {timeAgo(alert.createdAt)}.
          {alert.paused ? <span className="ml-2 rounded-sm border border-down px-1 text-down">Market paused</span> : null}
        </p>
        {error ? <p className="mt-1 text-xs text-down">{error}</p> : null}
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Keep
          </Button>
          <Button size="sm" disabled={busy} onClick={cancel} aria-label={`Sign and cancel the ${alert.symbol} alert`}>
            {busy ? "Cancelling…" : "Sign and cancel"}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)} aria-label={`Cancel the ${alert.symbol} alert`}>
          Cancel
        </Button>
      )}
    </li>
  );
}

/// The seven states of the lists: loading (skeleton rows), empty, error, populated, paused (a row says so),
/// not connected (the page shows the connect action instead), and sample (not applicable: alerts are never simulated).
function Lists({ wallet }: { wallet: string }) {
  const { data, isPending, isError, refetch } = useAlertList(wallet);
  const active = (data?.alerts ?? []).filter((a) => a.status === "active");
  const done = (data?.alerts ?? []).filter((a) => a.status === "triggered");

  let body;
  if (isPending) body = <Rows />;
  else if (isError)
    body = (
      <PanelState action={<Button size="sm" onClick={() => void refetch()}>Try again</Button>}>Your alerts could not be loaded. Try again in a moment.</PanelState>
    );
  else if (active.length === 0) body = <PanelState>No active alerts. Set one and it waits here until the price gets there.</PanelState>;
  else
    body = (
      <ul aria-label="Active alerts">
        {active.map((alert) => (
          <ActiveRow key={alert.id} alert={alert} wallet={wallet} />
        ))}
      </ul>
    );

  return (
    <>
      <Panel className="flex-1" title="Active alerts" actions={<span className="text-xs text-muted">{data ? `${active.length} of ${data.maxActive}` : ""}</span>}>
        {body}
      </Panel>
      <Panel title="History">
        {isPending || isError ? null : done.length === 0 ? (
          <p className="p-4 text-muted">Alerts that have fired show here.</p>
        ) : (
          <ul aria-label="Triggered alerts">
            {done.map((alert) => (
              <li key={alert.id} className="border-t border-line px-3 py-3 first:border-t-0">
                <p className="font-medium">{alertLabel(alert.symbol, alert.kind, alert.target, alert.basePrice)}</p>
                <p className="text-xs text-muted">
                  Fired at {alert.triggerPrice ? fmtAlertPrice(alert.triggerPrice) : NONE}, {alert.triggeredAt ? timeAgo(alert.triggeredAt) : ""}.
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function AlertsView() {
  const { address } = useAccount();
  const preset = useSearchParams().get("symbol")?.toUpperCase() ?? "";

  if (!address) {
    return (
      <Panel className="flex-1">
        <PanelState action={<ConnectButton />}>Connect a wallet to set price alerts. You sign a message to prove the alert is yours; nothing moves and nothing costs.</PanelState>
      </Panel>
    );
  }
  if (!env.apiUrl) {
    return (
      <Panel className="flex-1">
        <PanelState>Price alerts need the Zeno API, which is not configured here.</PanelState>
      </Panel>
    );
  }

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[26rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title="New alert">
          <NewAlert wallet={address} initialSymbol={preset} />
        </Panel>
        <Panel title="Browser notifications">
          <BrowserNotifications wallet={address} />
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Lists wallet={address} />
      </div>
    </div>
  );
}
