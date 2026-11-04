import { ALERT_KINDS, ALERT_WINDOW_SECONDS, type AlertKind, type AlertRequest } from "@zeno/sdk";
import { ADDRESS } from "./leaderboard.js";

/// Smart price alerts: the shape of each signed request. The signature check itself is `signedBy` in `copy.ts`,
/// and the text that is signed is `alertMessage` in `@zeno/sdk`, so the web app and this service cannot word it
/// differently.

export interface Signed {
  wallet: string;
  issuedAt: number;
  signature: `0x${string}`;
}
export type CreateBody = Signed & Extract<AlertRequest, { action: "create" }>;
export type CancelBody = Signed & Extract<AlertRequest, { action: "cancel" }>;
export type SubscribeBody = Signed & Extract<AlertRequest, { action: "subscribe" }>;

/// Browsers register with one of a handful of push services. Anything else is refused: the indexer makes an HTTPS
/// request to whatever address is stored here, so an open list would let a caller aim it at any host.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
/// Devices one wallet may keep; the oldest are dropped.
export const MAX_DEVICES = 5;

export const withinWindow = (issuedAt: number, nowSeconds = Math.floor(Date.now() / 1000)) => Math.abs(nowSeconds - issuedAt) <= ALERT_WINDOW_SECONDS;

const object = (body: unknown): Record<string, unknown> | undefined => (typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined);
const base64url = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 8 && value.length <= max && /^[A-Za-z0-9_-]+=*$/.test(value);

function signed(b: Record<string, unknown>): Signed | { error: string } {
  if (typeof b.wallet !== "string" || !ADDRESS.test(b.wallet)) return { error: "wallet must be an address" };
  if (typeof b.issuedAt !== "number" || !Number.isInteger(b.issuedAt) || b.issuedAt <= 0) return { error: "issuedAt must be unix seconds" };
  if (typeof b.signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(b.signature)) return { error: "signature must be a hex string" };
  return { wallet: b.wallet.toLowerCase(), issuedAt: b.issuedAt, signature: b.signature as `0x${string}` };
}

export function parseCreate(body: unknown): CreateBody | { error: string } {
  const b = object(body);
  if (!b) return { error: "body must be a JSON object" };
  const common = signed(b);
  if ("error" in common) return common;
  if (typeof b.symbol !== "string" || !/^[A-Z0-9]{1,16}$/.test(b.symbol)) return { error: "symbol must be a market symbol such as NVDA" };
  if (typeof b.kind !== "string" || !(ALERT_KINDS as readonly string[]).includes(b.kind)) return { error: `kind must be one of ${ALERT_KINDS.join(", ")}` };
  if (typeof b.value !== "string") return { error: "value must be a decimal string" };
  return { ...common, action: "create", symbol: b.symbol, kind: b.kind as AlertKind, value: b.value };
}

export function parseCancel(body: unknown): CancelBody | { error: string } {
  const b = object(body);
  if (!b) return { error: "body must be a JSON object" };
  const common = signed(b);
  if ("error" in common) return common;
  if (typeof b.id !== "number" || !Number.isInteger(b.id) || b.id <= 0) return { error: "id must be a whole number" };
  return { ...common, action: "cancel", id: b.id };
}

export function parseSubscribe(body: unknown): SubscribeBody | { error: string } {
  const b = object(body);
  if (!b) return { error: "body must be a JSON object" };
  const common = signed(b);
  if ("error" in common) return common;
  if (typeof b.endpoint !== "string" || b.endpoint.length > 2048) return { error: "endpoint must be the browser's push address" };
  let host: string;
  try {
    const url = new URL(b.endpoint);
    if (url.protocol !== "https:" || url.port !== "") throw new Error("not https");
    host = url.hostname;
  } catch {
    return { error: "endpoint must be an https push address" };
  }
  if (!PUSH_HOSTS.some((pattern) => pattern.test(host))) return { error: "that browser's push service is not supported" };
  if (!base64url(b.p256dh, 200) || !base64url(b.auth, 64)) return { error: "p256dh and auth must be the subscription's keys" };
  return { ...common, action: "subscribe", endpoint: b.endpoint, p256dh: b.p256dh, auth: b.auth };
}
