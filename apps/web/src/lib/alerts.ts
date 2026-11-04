import type { AlertKind } from "@zeno/sdk";
import { env } from "./env";

/// The alerts page's calls to `services/api`. Reads are public GETs keyed by wallet; the writes are signed, and
/// `post` in `./copy.ts` sends them. The text that is signed is `alertMessage` in `@zeno/sdk`.

export interface AlertRow {
  id: number;
  symbol: string;
  kind: AlertKind;
  /// A price in 18-decimal fixed point, or whole basis points for a percent alert.
  target: string;
  basePrice: string;
  status: "active" | "triggered";
  triggerPrice: string | null;
  createdAt: string;
  triggeredAt: string | null;
  paused: boolean;
}

export interface NotificationRow {
  id: number;
  alertId: number;
  title: string;
  body: string;
  symbol: string;
  createdAt: string;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${env.apiUrl}${path}`);
  if (!response.ok) throw new Error("alerts unavailable");
  return response.json();
}

/// The highest notification id this browser has shown for a wallet, kept per network. Newer ones count as unread.
const seenKey = (wallet: string) => `zeno-notifications-seen-v1-${env.chainId}-${wallet.toLowerCase()}`;

export function readSeen(wallet: string): number {
  try {
    return Number(localStorage.getItem(seenKey(wallet))) || 0;
  } catch {
    return 0;
  }
}

export function writeSeen(wallet: string, id: number): void {
  try {
    localStorage.setItem(seenKey(wallet), String(id));
  } catch {
    // Storage blocked: the count comes back after a reload, which is harmless.
  }
}

/// "5 min ago", "3 h ago", "2 d ago".
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1_440)} d ago`;
}
