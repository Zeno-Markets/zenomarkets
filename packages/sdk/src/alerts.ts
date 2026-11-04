import { formatUnits, keccak256, stringToHex } from "viem";

/// Smart price alerts. The rules live here so the API that accepts an alert, the indexer that fires it and the web
/// app that shows it cannot disagree: what a value means, when an alert has crossed, the text a wallet signs and the
/// text a notification carries. Amounts are 18-decimal fixed point (the index price's unit) as strings.

export const ALERT_KINDS = ["price_above", "price_below", "pct_up", "pct_down"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/// Active alerts one wallet may hold at a time.
export const MAX_ACTIVE_ALERTS = 25;
/// A signature is only good for this long around its stated time, so a captured one cannot be replayed later.
export const ALERT_WINDOW_SECONDS = 600;

const WAD = 10n ** 18n;
const BPS = 10_000n;

export const isPercent = (kind: AlertKind) => kind === "pct_up" || kind === "pct_down";

/// What the person typed becomes what is stored in `price_alerts.target`: a price in 18-decimal fixed point for
/// `price_above` / `price_below`, and whole basis points of change for `pct_up` / `pct_down` (5.25% is "525").
export function parseAlertValue(kind: AlertKind, text: string): { target: string } | { error: string } {
  if (isPercent(kind)) {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return { error: "Enter a percent such as 5 or 2.5." };
    const [whole = "0", frac = ""] = text.split(".");
    const bps = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
    if (bps === 0n) return { error: "The percent must be more than zero." };
    if (kind === "pct_down" && bps >= BPS) return { error: "A fall must be less than 100%." };
    if (kind === "pct_up" && bps > 100_000n) return { error: "A rise can be at most 1,000%." };
    return { target: bps.toString() };
  }
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(text)) return { error: "Enter a price such as 200 or 199.50." };
  const [whole = "0", frac = ""] = text.split(".");
  const wad = BigInt(whole) * WAD + BigInt(frac.padEnd(18, "0"));
  return wad === 0n ? { error: "The price must be more than zero." } : { target: wad.toString() };
}

export interface AlertTerms {
  kind: AlertKind;
  target: string;
  /// The index price recorded when the alert was made. A percent is measured against it.
  basePrice: string;
}

/// The index price at which an alert fires.
export function alertThreshold({ kind, target, basePrice }: AlertTerms): bigint {
  const base = BigInt(basePrice);
  if (kind === "pct_up") return (base * (BPS + BigInt(target))) / BPS;
  if (kind === "pct_down") return (base * (BPS - BigInt(target))) / BPS;
  return BigInt(target);
}

/// True when `price` has reached the alert's level. The alert is level-triggered: `price_above` was only accepted
/// while the price was below its target, so "at or past the level" is the same as "crossed it".
export function alertFires(terms: AlertTerms, price: bigint): boolean {
  const level = alertThreshold(terms);
  return terms.kind === "price_above" || terms.kind === "pct_up" ? price >= level : price <= level;
}

export function fmtAlertPrice(wad: bigint | string): string {
  const value = Number(formatUnits(BigInt(wad), 18));
  const text = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: value >= 1 ? 2 : 6 });
  return `$${text}`;
}

const percentText = (bps: string) => `${Number(bps) / 100}%`;

/// One short phrase for an alert: "NVDA at or above $200.00", "NVDA up 5% from $190.00".
export function alertLabel(symbol: string, kind: AlertKind, target: string, basePrice?: string): string {
  switch (kind) {
    case "price_above":
      return `${symbol} at or above ${fmtAlertPrice(target)}`;
    case "price_below":
      return `${symbol} at or below ${fmtAlertPrice(target)}`;
    case "pct_up":
      return `${symbol} up ${percentText(target)}${basePrice ? ` from ${fmtAlertPrice(basePrice)}` : ""}`;
    case "pct_down":
      return `${symbol} down ${percentText(target)}${basePrice ? ` from ${fmtAlertPrice(basePrice)}` : ""}`;
  }
}

/// What a notification says when an alert fires.
export function notificationText(a: AlertTerms & { symbol: string }, triggerPrice: bigint): { title: string; body: string } {
  const now = fmtAlertPrice(triggerPrice);
  return { title: alertLabel(a.symbol, a.kind, a.target, a.basePrice), body: `Now ${now}.` };
}

// --- The signed request --------------------------------------------------------------------------

export type AlertRequest =
  | { action: "create"; symbol: string; kind: AlertKind; /** What the person typed: dollars or percent. */ value: string }
  | { action: "cancel"; id: number }
  | { action: "subscribe"; endpoint: string; p256dh: string; auth: string };

function describe(request: AlertRequest): { line: string; canonical: string } {
  switch (request.action) {
    case "create": {
      const unit = isPercent(request.kind) ? `${request.value}%` : `$${request.value}`;
      const what = { price_above: "at or above", price_below: "at or below", pct_up: "up", pct_down: "down" }[request.kind];
      return { line: `${request.symbol} ${what} ${unit}`, canonical: `create|${request.symbol}|${request.kind}|${request.value}` };
    }
    case "cancel":
      return { line: `Cancel alert #${request.id}`, canonical: `cancel|${request.id}` };
    case "subscribe":
      return { line: "Send my alerts to this browser", canonical: `subscribe|${request.endpoint}|${request.p256dh}|${request.auth}` };
  }
}

/// The exact text a wallet signs (EIP-191). The web app shows it at the review step before asking. `Payload` is the
/// hash of every field of the request, so a signature for one alert cannot be reused for another.
export function alertMessage(wallet: string, request: AlertRequest, issuedAt: number): string {
  const { line, canonical } = describe(request);
  return [
    `Zeno price alerts: ${request.action}`,
    `Wallet: ${wallet.toLowerCase()}`,
    `Alert: ${line}`,
    `Payload: ${keccak256(stringToHex(canonical))}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}
