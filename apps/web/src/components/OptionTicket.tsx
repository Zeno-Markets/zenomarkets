"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Panel, ReviewStep, Row, TextField } from "@zeno/ui";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useOptionContractSize, usePerpMarketConfig, useSettlementDecimals, useVaultBalances } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useWalletZeno } from "@/hooks/useZeno";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import {
  expiryCode,
  fmtQuoteDelta,
  fmtQuoteGamma,
  fmtQuoteIv,
  fmtQuotePremium,
  fmtQuoteTheta,
  fmtQuoteVega,
  ivSourceLabel,
  plainSeries,
  strikeText,
} from "@/lib/options";
import { zenoRead } from "@/lib/zeno";
import { tradeBlocker } from "@/lib/market";
import { optionBuyReview } from "@/lib/review";
import { chain } from "@/lib/wagmi";
import { useModeStore } from "@/stores/mode";
import { useOptionOrder, type OptionSelection } from "@/stores/optionOrder";
import { useTerminal } from "@/stores/terminal";
import { errorMessage } from "@/stores/tx";
import { ConnectButton } from "./ConnectButton";
import { Disclosure } from "./Disclosure";
import { Term } from "./Term";
import { TicketModeToggle } from "./TicketModeToggle";
import { VaultControls } from "./VaultControls";

/// A signed price is only good for a short window; refresh it well inside that.
const REFRESH_MS = 10_000;
/// Ask for a fresh signed price when the one on screen has less than this many seconds left.
const MIN_QUOTE_SECONDS = 5n;
const MAX_CONTRACTS = 1_000_000n;
// Option prices on this screen are real, from the pricing service. Opening one is not simulated: it needs a

const codeOf = (selection: OptionSelection) =>
  `${selection.symbol}-${expiryCode(selection.expiry)}-${strikeText(selection.strike)}-${selection.type === "CALL" ? "C" : "P"}`;

function previewArgs(selection: OptionSelection, contracts: bigint, user?: `0x${string}`) {
  return { underlying: selection.symbol, type: selection.type, strike: selection.strike, expiry: selection.expiry, contracts, user };
}

/// PROJECT_BRIEF.md Sections 26 and 45. Every figure comes from `options.previewOpen`, which also
/// returns the signed premium the chain will charge, so the ticket never computes a price itself.
/// Options are buy-only in this deployment: the Vault pool is the counterparty.
///
/// A paused underlying is refused before anything else, with no review step. Guided ends on a review with
/// Back and Confirm; Pro keeps the one-shot button with the review figures collapsed above it. The sample
/// reaches the review too, so a visitor sees the maximum loss before connecting anything.
export function OptionTicket() {
  const selection = useOptionOrder((state) => state.selection);
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const wallet = useWalletZeno();
  const run = useTx();
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();

  const [contracts, setContracts] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();

  const debounced = useDebounced(contracts);
  const valid = /^[1-9]\d*$/.test(debounced) && BigInt(debounced) <= MAX_CONTRACTS;
  const settled = contracts === debounced;

  const preview = useQuery({
    queryKey: ["option-preview", selection?.symbol, String(selection?.expiry), String(selection?.strike), selection?.type, debounced, address],
    queryFn: () => zenoRead.options.previewOpen(previewArgs(selection!, BigInt(debounced), address)),
    enabled: Boolean(selection && valid && env.apiUrl),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const p = selection && valid ? preview.data : undefined;
  const review = p && selection ? optionBuyReview(p, { symbol: selection.symbol, type: selection.type, decimals }) : undefined;
  const guided = useModeStore((state) => state.ticket) === "guided";
  const [reviewing, setReviewing] = useState(false);
  const code = selection ? codeOf(selection) : "";
  useEffect(() => setReviewing(false), [code]);

  // Read before the wallet and before a series is picked, as `OrderPanel` does: a paused market is shut
  // whoever is asking, so the ticket says so for the underlying on screen.
  const underlying = useTerminal((state) => state.symbol);
  const paused = tradeBlocker(usePerpMarketConfig(selection?.symbol ?? underlying)?.active);
  const contractSize = useOptionContractSize(selection?.symbol ?? underlying).data;

  const onRightChain = isConnected && chainId === chain.id;
  const problem = paused
    ? paused
    : !onRightChain || !p
    ? undefined
    : !p.authorization
      ? "Options cannot be opened right now: the pricing service is not signing prices. Nothing is wrong with your funds. Try again later."
      : p.violations[0]
        ? errorMessage(p.violations[0])
        : p.sufficientCollateral === false
          ? "Not enough available collateral. Deposit first."
          : undefined;
  const waiting = paused
    ? undefined
    : !selection
    ? "Pick a call or put from the chain."
    : !env.apiUrl
      ? "Option prices are not available right now. Try again in a moment."
      : !valid
        ? "Enter a whole number of contracts."
        : !onRightChain
          ? undefined
          : !settled || !p
            ? "Calculating…"
            : undefined;
  const blocker = problem ?? waiting;

  async function submit() {
    if (paused || !wallet || !selection || !p?.authorization || !address) return;
    setSubmitting(true);
    setNotice(undefined);

    // Never charge a price the person has not seen: if the signed quote is about to lapse, get a
    // new one and stop for review when the premium moved.
    let authorization = p.authorization;
    if (authorization.validUntil <= BigInt(Math.floor(Date.now() / 1000)) + MIN_QUOTE_SECONDS) {
      try {
        const fresh = await zenoRead.options.previewOpen(previewArgs(selection, BigInt(debounced), address));
        if (!fresh.authorization || fresh.premium !== p.premium) {
          setNotice(`The price changed to ${fmtUsd(fresh.premium, decimals)}. Review it and confirm again.`);
          await preview.refetch();
          setSubmitting(false);
          return;
        }
        authorization = fresh.authorization;
      } catch {
        setNotice("Could not refresh the option price. Try again.");
        setSubmitting(false);
        return;
      }
    }

    const title = `Buy ${selection.type === "CALL" ? "call" : "put"}`;
    const summary = `${codeOf(selection)} · ${debounced} contract${debounced === "1" ? "" : "s"} · premium ${fmtUsd(p.premium, decimals)}`;
    const result = await run({ title, summary }, (tx) =>
      wallet.options.openPosition({
        underlying: selection.symbol,
        type: selection.type,
        strike: selection.strike,
        expiry: selection.expiry,
        contracts: BigInt(debounced),
        authorization,
        tx,
      }),
    );
    if (result.ok) {
      setContracts("1");
      setReviewing(false);
    }
    setSubmitting(false);
  }

  const reviewButton = (
    <Button variant={selection?.type === "PUT" ? "down" : "up"} className="w-full" disabled={Boolean(blocker) || !review?.rows} onClick={() => setReviewing(true)}>
      Review order
    </Button>
  );
  const action = paused ? (
    <>
      <Button variant="secondary" className="w-full" disabled>
        Market paused
      </Button>
      <p className="text-xs leading-snug text-muted">This market still shows prices, but it is not taking new orders right now.</p>
    </>
  ) : !isConnected ? (
    <ConnectButton className="w-full" />
  ) : chainId !== chain.id ? (
    <Button variant="primary" className="w-full" onClick={() => switchChain({ chainId: chain.id })}>
      Switch to {chain.name}
    </Button>
  ) : guided ? (
    reviewButton
  ) : (
    <Button
      variant={selection?.type === "PUT" ? "down" : "up"}
      className="w-full"
      disabled={Boolean(blocker) || submitting || !wallet}
      onClick={submit}
    >
      {submitting ? "Opening…" : selection ? `Buy ${selection.type === "CALL" ? "call" : "put"}` : "Buy"}
    </Button>
  );

  if (guided && reviewing && review?.rows && selection && !paused && (onRightChain && wallet)) {
    const label = `Buy ${selection.type === "CALL" ? "call" : "put"}`;
    return (
      <Panel title="Review order" actions={<TicketModeToggle />} className="h-full overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <ReviewStep
            title={`${label}: ${codeOf(selection)}`}
            rows={review.rows}
            worstCase={review.worstCase}
            note={notice}
            blocked={problem ?? (preview.isPlaceholderData ? "Updating the figures…" : undefined)}
            busy={submitting}
            confirmLabel={`Confirm: ${label.toLowerCase()}`}
            confirmVariant={selection.type === "PUT" ? "down" : "up"}
            onBack={() => setReviewing(false)}
            onConfirm={submit}
          />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Option order" actions={<TicketModeToggle />} className="h-full overflow-y-auto">
      <VaultControls />

      <div className="flex flex-col gap-3 p-3">
        <div>
          <p className="text-xs text-muted">Series</p>
          <p className="mt-1 font-medium">{selection ? plainSeries(selection.symbol, selection.type, selection.strike, selection.expiry) : <span className="text-muted">Pick an ask in the chain</span>}</p>
          {selection ? <p className="mt-0.5 text-xs text-faint">{codeOf(selection)}</p> : null}
        </div>

        <TextField
          label="Contracts"
          value={contracts}
          onValueChange={(value) => {
            setContracts(value);
            setNotice(undefined);
          }}
          placeholder="1"
          invalid={contracts !== "" && !/^[1-9]\d*$/.test(contracts)}
          hint={balances ? `Available ${fmtUsd(balances.available, decimals)}` : undefined}
        />

        {selection && contractSize !== undefined ? (
          <p className="text-xs text-faint">
            1 contract = {contractSize.toLocaleString("en-US", { maximumFractionDigits: 8 })} {selection.symbol}
          </p>
        ) : null}

        {p ? (
          <dl className="border-t border-line pt-2">
            <Row label="Premium">{fmtUsd(p.premium, decimals)}</Row>
            <Row label={`Fee (${fmtBps(p.feeBps)})`}>{fmtUsd(p.fee, decimals)}</Row>
            <Row label="Total from vault" className="border-t border-line font-medium">
              {fmtUsd(p.totalRequired, decimals)}
            </Row>
            <Row label={<Term term="breakEven">Break-even at expiry</Term>}>{fmtPrice(p.breakEven)}</Row>
            <Row label={<Term term="maxLoss">Max loss</Term>}>{fmtUsd(p.maxLoss, decimals)}</Row>
            <Row label="Max profit">{p.maxProfit === null ? "Unlimited" : fmtUsd(p.maxProfit, decimals)}</Row>
          </dl>
        ) : null}

        {p ? (
          <Disclosure id="option-ticket" label="The numbers behind the price">
            <dl>
              <Row label="Price per contract">{fmtQuotePremium(p.quote.ask)}</Row>
              <Row label="Sell-back price per contract">{fmtQuotePremium(p.quote.bid)}</Row>
              <Row label={<Term term="iv">{`IV (${ivSourceLabel(p.quote.ivSource)})`}</Term>}>{fmtQuoteIv(p.quote.iv)}</Row>
              <Row label={<Term term="delta">Delta</Term>}>{fmtQuoteDelta(p.quote.delta)}</Row>
              <Row label={<Term term="gamma">Gamma</Term>}>{fmtQuoteGamma(p.quote.gamma)}</Row>
              <Row label={<Term term="theta">Theta per day</Term>}>{fmtQuoteTheta(p.quote.theta)}</Row>
              <Row label={<Term term="vega">Vega per vol point</Term>}>{fmtQuoteVega(p.quote.vega)}</Row>
            </dl>
          </Disclosure>
        ) : null}

        {!guided && review?.rows ? <ReviewStep title="Review: every figure" rows={review.rows} worstCase={review.worstCase} className="border-t border-line pt-1" /> : null}
        {preview.error ? <p className="text-down">Could not price this order. Check the connection and try again.</p> : null}
        {notice ? <p className="leading-snug text-down">{notice}</p> : null}
        {problem ? <p className="leading-snug text-down">{problem}</p> : waiting ? <p className="text-muted">{waiting}</p> : null}
        {action}
      </div>
    </Panel>
  );
}
