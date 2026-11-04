"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Panel, ReviewStep, Row, Segmented, Skeleton, TextField } from "@zeno/ui";
import { toBaseUnits, type OrderType } from "@zeno/sdk";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { usePerpMarket, usePerpMarketConfig, useSettlementDecimals, useVaultBalances } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useWalletZeno } from "@/hooks/useZeno";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import { tradeBlocker } from "@/lib/market";
import { LIMIT_EXPIRIES, limitDirectionNote, limitExpirySeconds, parseLimitPrice, type LimitExpiry } from "@/lib/limit";
import { zenoRead } from "@/lib/zeno";
import { perpOpenReview } from "@/lib/review";
import { chain } from "@/lib/wagmi";
import { useModeStore } from "@/stores/mode";
import { errorMessage } from "@/stores/tx";
import { useTerminal } from "@/stores/terminal";
import { ConnectButton } from "./ConnectButton";
import { Disclosure } from "./Disclosure";
import { RiskLadder } from "./RiskLadder";
import { Term } from "./Term";
import { TicketModeToggle } from "./TicketModeToggle";
import { VaultControls } from "./VaultControls";

/// PROJECT_BRIEF.md Section 27. Every figure below the form comes from `perps.previewOpen`, so
/// the terminal never recomputes fees or liquidation price itself.
///
/// Guided (the default) ends on a review step with Back and Confirm; Pro keeps the one-shot button with
/// the same review figures above it. An order whose liquidation price cannot be stated is refused in both.
export function OrderPanel() {
  const symbol = useTerminal((state) => state.symbol);
  const { address, isConnected, chainId } = useAccount();
  /// Whether an order can be sent from here: a wallet, on the right network.
  const ready = isConnected && chainId === chain.id;
  const { switchChain } = useSwitchChain();
  const wallet = useWalletZeno();
  const run = useTx();
  const { data: market } = usePerpMarket(symbol);
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();

  const side = useTerminal((state) => state.side);
  const setSide = useTerminal((state) => state.setSide);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [marginMode, setMarginMode] = useState<"ISOLATED" | "CROSS">("ISOLATED");
  const [limitPrice, setLimitPrice] = useState("");
  const [expiry, setExpiry] = useState<LimitExpiry>("24h");
  const [collateral, setCollateral] = useState("");
  const [chosenLeverage, setChosenLeverage] = useState<bigint>();
  const [submitting, setSubmitting] = useState(false);
  const guided = useModeStore((state) => state.ticket) === "guided";
  const [reviewing, setReviewing] = useState(false);
  // A side or market picked elsewhere (the phone bar, the market list) is a different order: back to the form.
  useEffect(() => setReviewing(false), [side, symbol]);

  const tiers = market?.risk.allowedLeverageTiers ?? [];
  const leverage = chosenLeverage && tiers.includes(chosenLeverage) ? chosenLeverage : tiers[0];

  const debouncedCollateral = useDebounced(collateral);
  const validAmount =
    /^\d+(\.\d+)?$/.test(debouncedCollateral) &&
    (debouncedCollateral.split(".")[1]?.length ?? 0) <= decimals &&
    Number(debouncedCollateral) > 0;

  const isLimit = orderType === "LIMIT";
  /// A limit order fills later through the keeper, which opens an isolated position, so cross margin
  /// applies to market orders only.
  const useCross = marginMode === "CROSS" && env.crossMargin && !isLimit;
  const debouncedLimit = useDebounced(limitPrice);
  const trigger = parseLimitPrice(debouncedLimit);
  const validLimit = !isLimit || trigger !== undefined;

  const preview = useQuery({
    queryKey: ["preview", symbol, side, orderType, isLimit ? debouncedLimit : "", debouncedCollateral, String(leverage), address],
    queryFn: () =>
      zenoRead.perps.previewOpen({
        market: symbol,
        side,
        collateral: debouncedCollateral,
        leverage: Number(leverage),
        user: address,
        ...(isLimit ? { orderType, limitPrice: trigger } : {}),
      }),
    enabled: Boolean(symbol && leverage && validAmount && validLimit),
    refetchInterval: 4_000,
    placeholderData: (previous) => previous,
  });
  const p = validAmount && validLimit ? preview.data : undefined;
  const cap = market?.risk.maxPositionNotional;
  const review = p ? perpOpenReview(p, { symbol, decimals, isLimit, cap }) : undefined;

  // A paused market refuses every new position, whoever is asking, so it is read before the wallet
  // is: the ticket must say why it is shut without first demanding a connection and an amount.
  const paused = tradeBlocker(usePerpMarketConfig(symbol)?.active);

  // `problem` is something the person must fix; `waiting` just explains why the button is idle.
  const problem =
    paused
      ? paused
      : !ready || !validAmount || !p
      ? undefined
      : p.violations[0]
        ? errorMessage(p.violations[0])
        : p.sufficientCollateral === false
          ? "Not enough available collateral. Deposit first."
          : review?.refusal;
  const waiting =
    paused || !ready
      ? undefined
      : !validAmount
        ? "Enter a collateral amount."
        : !validLimit
          ? "Enter a limit price."
          : !p
            ? "Calculating…"
            : undefined;
  const blocker = problem ?? waiting;
  /// A figure once the preview is in, a pulse while it is being priced, a dash before there is anything to price.
  const show = (value: string | undefined | "") => (value ? value : validAmount && validLimit && preview.isFetching ? <Skeleton className="w-16" /> : <span aria-label="not yet" className="inline-block h-1.5 w-8 rounded-full bg-line align-middle" />);

  async function submit() {
    // Sign only what was reviewed: a preview still showing an earlier side is not this order.
    if (!wallet || !leverage || !p || p.side !== side || review?.refusal) return;
    setSubmitting(true);
    const direction = side === "LONG" ? "long" : "short";
    const summary = `${symbol}-PERP · ${side === "LONG" ? "Long" : "Short"} · ${fmtUsd(p.notional, decimals, 0)} · ${leverage}x`;
    const result = isLimit
      ? await run({ title: `Place limit ${direction}`, summary: `${summary} · at ${fmtPrice(p.entryPrice)}` }, (tx) =>
          wallet.perps.placeLimitOrder({
            market: symbol,
            side,
            collateral: toBaseUnits(debouncedCollateral, decimals),
            leverage,
            limitPrice: p.entryPrice,
            expiry: BigInt(Math.floor(Date.now() / 1000) + limitExpirySeconds(expiry)),
            tx,
          }),
        )
      : await run({ title: `Open ${direction}`, summary }, (tx) =>
          wallet.perps.openPosition({
            market: symbol,
            side,
            collateral: toBaseUnits(debouncedCollateral, decimals),
            leverage,
            ...(useCross ? { marginMode: "CROSS" as const } : {}),
            tx,
          }),
        );
    if (result.ok) {
      setCollateral("");
      setLimitPrice("");
      setReviewing(false);
    }
    setSubmitting(false);
  }

  const actionLabel = `${isLimit ? "Place limit" : "Open"} ${side === "LONG" ? "long" : "short"}`;
  const action = paused ? (
    // A paused market refuses the trade before the wallet matters, so the connect prompt would be
    // a dead end: the button states the refusal instead.
    <>
      <Button variant="secondary" className="w-full" disabled>
        Market paused
      </Button>
      <p className="text-xs leading-snug text-muted">This market still shows prices, but it is not taking new orders right now.</p>
    </>
  ) : !isConnected ? (
    <ConnectButton className="w-full" />
  ) : !ready ? (
    <Button variant="primary" className="w-full" onClick={() => switchChain({ chainId: chain.id })}>
      Switch to {chain.name}
    </Button>
  ) : guided ? (
    <Button variant={side === "LONG" ? "up" : "down"} className="w-full" disabled={Boolean(blocker) || !wallet} onClick={() => setReviewing(true)}>
      Review order
    </Button>
  ) : (
    <Button
      variant={side === "LONG" ? "up" : "down"}
      className="w-full"
      disabled={Boolean(blocker) || submitting || !wallet}
      onClick={submit}
    >
      {submitting
        ? isLimit
          ? "Placing…"
          : "Opening…"
        : actionLabel}
    </Button>
  );

  // The review replaces the form, so nothing can change under it. If the order stops being reviewable
  // (refused, repriced to a refusal, paused, wallet gone or on the wrong network) the form comes back
  // with the reason.
  if (guided && reviewing && review?.rows && !paused && ready && wallet) {
    return (
      <Panel title="Review order" actions={<TicketModeToggle />} className="h-full overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <ReviewStep
            title={`${actionLabel} ${symbol}-PERP`}
            rows={review.rows}
            worstCase={review.worstCase}
            blocked={problem ?? (preview.isPlaceholderData ? "Updating the figures…" : undefined)}
            busy={submitting}
            confirmLabel={`Confirm: ${actionLabel.toLowerCase()}`}
            confirmVariant={side === "LONG" ? "up" : "down"}
            onBack={() => setReviewing(false)}
            onConfirm={submit}
          />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Order" actions={<TicketModeToggle />} className="h-full overflow-y-auto">
      <VaultControls />

      <div className="flex flex-col gap-3 p-3">
        <Segmented
          label="Side"
          size="lg"
          value={side}
          onChange={setSide}
          activeTone={(value) => (value === "LONG" ? "up" : "down")}
          options={[
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
        />
        <Segmented
          label="Order type"
          value={orderType}
          onChange={setOrderType}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit", disabled: !env.limitOrders },
          ]}
        />
        {env.limitOrders ? null : (
          <p className="text-xs leading-snug text-muted">Limit orders need the latest contracts, which are not deployed on this network yet.</p>
        )}

        {isLimit ? (
          <>
            <TextField
              label="Limit price"
              value={limitPrice}
              onValueChange={setLimitPrice}
              suffix="USD"
              placeholder={market ? fmtPrice(market.markPrice).replace(/,/g, "") : "0.00"}
              invalid={limitPrice !== "" && trigger === undefined}
              hint={
                market
                  ? (limitDirectionNote(side === "LONG", trigger, market.markPrice) ??
                    `${side === "LONG" ? "Fills at or below" : "Fills at or above"} this price. Mark ${fmtPrice(market.markPrice)}.`)
                  : undefined
              }
            />
            <div>
              <p className="mb-1 text-xs text-muted">Expires in</p>
              <Segmented
                label="Expiry"
                value={expiry}
                onChange={setExpiry}
                options={LIMIT_EXPIRIES.map((value) => ({ value, label: value }))}
              />
            </div>
          </>
        ) : null}

        <TextField
          label="Collateral"
          value={collateral}
          onValueChange={setCollateral}
          suffix="USD"
          placeholder="100"
          hint={balances ? `Available ${fmtUsd(balances.available, decimals)}` : undefined}
        />

        <div>
          <p className="mb-1 text-xs text-muted">Leverage</p>
          {tiers.length === 0 ? (
            <Skeleton className="w-24" />
          ) : (
            <Segmented
              label="Leverage"
              value={Number(leverage)}
              onChange={(value) => setChosenLeverage(BigInt(value))}
              options={tiers.map((tier) => ({ value: Number(tier), label: `${tier}x` }))}
            />
          )}
        </div>

        {p ? (
          <RiskLadder isLong={side === "LONG"} entry={p.entryPrice} liquidation={p.liquidationPrice} worst={p.worstPrice} />
        ) : (
          <p className="flex min-h-[148px] items-center justify-center border border-dashed border-line p-3 text-center text-xs text-muted">
            Enter collateral to see how far the price can move before liquidation.
          </p>
        )}
        {/* Always shown, so the button below does not jump when the numbers arrive. */}
        <dl className="border-t border-line pt-2">
          <Row label="Size">{show(p && fmtUsd(p.notional, decimals))}</Row>
          {isLimit ? (
            <Row label={side === "LONG" ? "Fills at or below" : "Fills at or above"}>{show(p && fmtPrice(p.entryPrice))}</Row>
          ) : (
            <Row label="Estimated entry">{show(p && fmtPrice(p.entryPrice))}</Row>
          )}
          <Row label={<Term term="liquidationPrice">Liquidation price</Term>}>{show(p && fmtPrice(p.liquidationPrice))}</Row>
          <Row label={p ? `Fee (${fmtBps(p.feeBps)})` : "Fee"}>{show(p && fmtUsd(p.fee, decimals))}</Row>
          <Row label={isLimit ? "Needed when it fills" : "Total from vault"} className="border-t border-line font-medium">
            {show(p && fmtUsd(p.totalRequired, decimals))}
          </Row>
        </dl>
        <Disclosure id="order-panel" label="More detail">
          {env.crossMargin ? (
            <>
              <p className="-mb-2 text-xs text-muted">
                <Term term="marginMode">Margin mode</Term>
              </p>
              <Segmented
                label="Margin mode"
                value={marginMode}
                onChange={setMarginMode}
                options={[
                  { value: "ISOLATED", label: "Isolated" },
                  { value: "CROSS", label: "Cross", disabled: isLimit },
                ]}
              />
            </>
          ) : null}
          {useCross ? (
            <p className="text-xs leading-snug text-muted">
              Cross: this position is backed by your whole account, not only its own margin. It is liquidated when the account&apos;s equity falls under its requirement, and withdrawals that would leave it too thin are refused.
            </p>
          ) : null}
          <dl>
            {isLimit ? null : <Row label={<Term term="worstPrice">Worst accepted price</Term>}>{show(p && fmtPrice(p.worstPrice))}</Row>}
            <Row label={<Term term="fundingRate">Funding rate</Term>}>{show(p && fmtBps(p.fundingRateBps))}</Row>
          </dl>
        </Disclosure>
        {p && isLimit ? (
          <p className="text-xs leading-snug text-muted">
            Nothing is reserved while the order waits. The margin and fee are taken from your vault balance when it fills, so keep
            that balance available. Cancel it any time from Portfolio.
          </p>
        ) : null}

        {preview.error ? (
          <p className="text-down">
            Could not price this order. Check the connection and try again.
          </p>
        ) : null}
        {!guided && review?.rows ? <ReviewStep title="Review: every figure" rows={review.rows} worstCase={review.worstCase} className="border-t border-line pt-1" /> : null}
        {problem ? <p className="leading-snug text-down">{problem}</p> : waiting ? <p className="text-muted">{waiting}</p> : null}
        {action}
      </div>
    </Panel>
  );
}
