import { toBaseUnits } from "@zeno/sdk";
import { env } from "./env";

/// The copy flow's numbers and its two signed calls to `services/api`. Wording of the signed text lives in the
/// SDK (`copyFollowMessage`) so this file and the API cannot disagree.

export const COPY_LEVERAGE_CHOICES = [1, 2, 3, 5] as const;
export const COPY_DEFAULTS = { budget: "100", maxTrade: "200", maxExposure: "400", maxLeverage: 3 };

const USD = /^\d+(\.\d+)?$/;

/// A dollar amount typed by a person, in settlement base units; undefined when it is not a positive amount.
export function usdToBase(text: string, decimals: number): bigint | undefined {
  if (!USD.test(text) || (text.split(".")[1]?.length ?? 0) > decimals) return undefined;
  const value = toBaseUnits(text, decimals);
  return value > 0n ? value : undefined;
}

/// What the caps mean in one sentence each, for the review step. Returns the first problem, or undefined.
export function capsProblem(o: { budget: bigint | undefined; maxTrade: bigint | undefined; maxExposure: bigint | undefined }): string | undefined {
  if (!o.budget) return "Enter a budget greater than zero.";
  if (!o.maxTrade) return "Enter a limit per trade greater than zero.";
  if (!o.maxExposure) return "Enter a total exposure limit greater than zero.";
  if (o.maxTrade > o.maxExposure) return "The limit per trade cannot be more than the total exposure limit.";
  return undefined;
}

export async function post(path: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${env.apiUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: error ?? "The request was refused." };
  } catch {
    return { ok: false, error: "Could not reach Zeno. Check your connection and try again." };
  }
}

export const postFollow = (body: unknown) => post("/v1/copy/follows", body);
export const postUnfollow = (body: unknown) => post("/v1/copy/unfollow", body);
