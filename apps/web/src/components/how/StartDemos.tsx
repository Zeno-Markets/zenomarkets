"use client";

import { useState, type ReactNode } from "react";
import { MONO } from "@/lib/frame";
import { Num, cn } from "@zeno/ui";
import { Choice, Note, Steps, signed, useGoal, useMistake, usd } from "./kit";

/// Chapter 1. The vault in one picture: money moves wallet to vault to position and back, and only the
/// free part can leave. The numbers are the example's own; the rules are the ones in /docs ("Deposit,
/// trade, withdraw").

const MARGIN = 200;
const FEE = 2;
const GAIN = 30;

export function VaultDemo() {
  const goal = useGoal();
  const mistake = useMistake();
  const [net, setNet] = useState<"testnet" | "mainnet">("testnet");
  const [connected, setConnected] = useState(false);
  const [wallet, setWallet] = useState(1000);
  const [vault, setVault] = useState(0);
  const [locked, setLocked] = useState(0);
  const [stage, setStage] = useState(0);

  const free = vault - locked;
  const canOpen = connected && locked === 0 && free >= MARGIN + FEE;
  const move = (to: number) => setStage((value) => Math.max(value, to));

  return (
    <>
      <Choice
        label="Network"
        value={net}
        onChange={setNet}
        options={[
          { value: "testnet", label: "Robinhood Chain Testnet" },
          { value: "mainnet", label: "Robinhood Chain Mainnet" },
        ]}
      />
      <Note tone={net === "mainnet" ? "down" : "up"}>
        {net === "testnet" ? "Free test tokens, real market prices. Try every feature end to end." : "Real funds, settled in USDG on Robinhood Chain."}
      </Note>

      <Steps steps={["Connect", "Deposit", "Trade", "Withdraw"]} current={stage} />

      {connected ? (
        <p className={cn(MONO, "text-xs text-faint")}>0x75…e78147 · connected (example)</p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setConnected(true);
            goal("connect");
            move(1);
          }}
          className="h-11 rounded-control bg-accent text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press"
        >
          Connect wallet
        </button>
      )}

      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.4fr] sm:gap-4">
        <div className="rounded-control border border-line bg-ground p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">Your wallet</p>
          <Num className="mt-1 block font-display text-figure font-semibold">{usd(wallet, 0)}</Num>
          <p className="mt-1 text-xs text-faint">Tokens you hold</p>
        </div>
        <span aria-hidden="true" className="flex items-center justify-center text-muted">
          <span className="sm:hidden">↓</span>
          <span className="max-sm:hidden">→</span>
        </span>
        <div className="rounded-control border border-line bg-ground p-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted">ZENO vault</p>
          <Num className="mt-1 block font-display text-figure font-semibold">{usd(vault)}</Num>
          <div className="mt-3 flex h-3 overflow-hidden rounded-sharp bg-raised" role="img" aria-label={`${usd(free)} free, ${usd(locked)} locked as margin`}>
            <span className="bg-accent transition-[width] duration-150" style={{ width: `${vault ? (free / vault) * 100 : 0}%` }} />
            <span className="bg-muted transition-[width] duration-150" style={{ width: `${vault ? (locked / vault) * 100 : 0}%` }} />
          </div>
          <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs">
            <span className="text-text">■ Free {usd(free)}</span>
            <span className="text-muted">■ Locked as margin {usd(locked)}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Action
          ok={connected && wallet >= 250}
          blocked={mistake}
          onRun={() => {
            setWallet(wallet - 250);
            setVault(vault + 250);
            goal("deposit");
            move(2);
          }}
        >
          Deposit $250
        </Action>
        <Action
          ok={canOpen}
          blocked={mistake}
          onRun={() => {
            setVault(vault - FEE);
            setLocked(MARGIN);
            goal("trade");
            move(3);
          }}
        >
          Open a position ({usd(MARGIN, 0)} margin)
        </Action>
        <Action
          ok={locked > 0}
          blocked={mistake}
          onRun={() => {
            setVault(vault + GAIN);
            setLocked(0);
          }}
        >
          Close it ({signed(GAIN, 0)} profit)
        </Action>
        <Action
          ok={connected && free > 0}
          blocked={mistake}
          onRun={() => {
            setWallet(wallet + free);
            setVault(vault - free);
            goal("withdraw");
          }}
        >
          Withdraw {usd(free)} (what is free)
        </Action>
      </div>

      <Note>
        {!connected
          ? "Every account action needs a wallet. Connect first."
          : vault === 0
            ? "Deposit first. The vault only holds what you put in."
            : locked > 0
              ? `A position locks its margin. Only the ${usd(free)} that is free can leave. Close the position to free the rest.`
              : free < MARGIN + FEE
                ? `A trade needs the margin and the ${usd(FEE, 0)} fee free at the same time. The fee is charged on top of the margin. Deposit more.`
                : `You can open a position: ${usd(MARGIN, 0)} margin plus a ${usd(FEE, 0)} fee (example fee).`}
      </Note>
    </>
  );
}

/// A blocked action is not dead: pressing it counts as a misstep, and the note below says why it is blocked.
function Action({ ok, blocked, onRun, children }: { ok: boolean; blocked: () => void; onRun: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-disabled={!ok}
      onClick={ok ? onRun : blocked}
      className={cn("h-11 rounded-control border border-line bg-raised px-3 text-sm font-medium transition-colors duration-150", ok ? "hover:border-accent-fg hover:bg-accent-soft hover:text-accent-fg active:bg-accent active:text-accent-ink" : "cursor-not-allowed text-faint")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- markets

type Status = "tradable" | "quote" | "paused";
const MARKETS: { sym: string; name: string; group: "US" | "China" | "Crypto"; price: number; status: Status }[] = [
  { sym: "TSLA", name: "Tesla", group: "US", price: 248.3, status: "tradable" },
  { sym: "NVDA", name: "NVIDIA", group: "US", price: 131.2, status: "tradable" },
  { sym: "AAPL", name: "Apple", group: "US", price: 229.4, status: "paused" },
  { sym: "BABA", name: "Alibaba", group: "China", price: 88.7, status: "tradable" },
  { sym: "TSM", name: "TSMC", group: "China", price: 172.6, status: "tradable" },
  { sym: "BIDU", name: "Baidu", group: "China", price: 96.4, status: "quote" },
  { sym: "ETH", name: "Ether", group: "Crypto", price: 2481, status: "tradable" },
  { sym: "BTC", name: "Bitcoin", group: "Crypto", price: 61250, status: "tradable" },
];

const STATUS_LABEL: Record<Status, string> = { tradable: "Tradable", quote: "Quote only", paused: "Paused" };
const STATUS_TEXT: Record<Status, string> = {
  tradable: "This market has a live price feed. Long and short are open.",
  quote: "Priced from the Robinhood reference quote. There is no Chainlink feed for it yet, so it shows a price and has no trade buttons.",
  paused: "A paused market is still shipped: it renders and it prices. It refuses new trades, and the page says why in plain words.",
};

export function MarketsDemo() {
  const goal = useGoal();
  const [group, setGroup] = useState<"All" | "US" | "China" | "Crypto">("All");
  const [picked, setPicked] = useState("TSLA");
  const rows = MARKETS.filter((market) => group === "All" || market.group === group);
  const market = MARKETS.find((item) => item.sym === picked)!;

  return (
    <>
      <Choice
        label="Market group"
        value={group}
        onChange={(value) => {
          setGroup(value);
          if (value === "China") goal("group");
        }}
        options={(["All", "US", "China", "Crypto"] as const).map((value) => ({ value, label: value }))}
      />
      <ul className="divide-y divide-line overflow-hidden rounded-control border border-line bg-ground">
        {rows.map((row) => (
          <li key={row.sym}>
            <button
              type="button"
              aria-pressed={row.sym === picked}
              onClick={() => {
                setPicked(row.sym);
                if (row.status === "paused") goal("paused");
                if (row.status === "quote") goal("quote");
              }}
              className={cn("flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors duration-150", row.sym === picked ? "bg-accent text-accent-ink" : "hover:bg-accent-soft hover:text-accent-fg")}
            >
              <span className="w-14 font-medium">{row.sym}</span>
              <span className="min-w-0 flex-1 truncate opacity-80">{row.name}</span>
              <Num tone="inherit" className="shrink-0">{usd(row.price, row.price > 1000 ? 0 : 2)}</Num>
              <span className={cn("w-[5.5rem] shrink-0 text-right text-[11px] uppercase tracking-[0.08em]", row.sym === picked ? "" : row.status === "tradable" ? "text-up" : row.status === "paused" ? "text-down" : "text-muted")}>
                {STATUS_LABEL[row.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded-control border border-line bg-ground p-3">
        <p className="font-medium">
          {market.sym} <span className="font-normal text-muted">· {market.group}</span>
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{STATUS_TEXT[market.status]}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(["Long", "Short"] as const).map((side) => (
            <button
              key={side}
              type="button"
              disabled={market.status !== "tradable"}
              className={cn("h-11 rounded-control text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-line disabled:text-faint", side === "Long" ? "bg-up text-ground hover:bg-up-hover" : "bg-down text-ground hover:bg-down-hover")}
            >
              {side}
            </button>
          ))}
        </div>
        {market.status === "tradable" ? <p className="mt-2 text-xs text-faint">Next: size, review, sign. Chapter 3 plays that part.</p> : null}
      </div>
    </>
  );
}
