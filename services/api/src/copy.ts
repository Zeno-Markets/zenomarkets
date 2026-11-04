import { copyFollowMessage, copyUnfollowMessage } from "@zeno/sdk";
import { recoverMessageAddress } from "viem";
import { ADDRESS } from "./leaderboard.js";

/// Copy trading follows (`docs/COPY_TRADING.md`). A follower proves a follow with an EIP-191 signature over the
/// exact caps, so nobody can follow, change a cap or stop a follow in another wallet's name. The signature says
/// what the follower agreed to; what the executor may do on chain is a separate authorisation (the follower makes
/// the executor a delegate of their copy subaccount), which the executor re-checks on every pass.

/// A signature is only good for this long around its stated time, so a captured one cannot be replayed later.
export const COPY_WINDOW_SECONDS = 600;
const MAX_MARKETS = 40;

export interface FollowRequest {
  follower: string;
  leader: string;
  subaccount: string;
  /// Settlement-token base units, as whole-number strings.
  maxTradeSize: string;
  maxExposure: string;
  maxLeverage: number;
  /// Symbols the follower allows, or null for every market.
  markets: string[] | null;
  issuedAt: number;
  signature: `0x${string}`;
}

export interface UnfollowRequest {
  follower: string;
  leader: string;
  issuedAt: number;
  signature: `0x${string}`;
}

export const followMessage = copyFollowMessage;
export const unfollowMessage = copyUnfollowMessage;

const wholeNumber = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,38}$/.test(value);
const hex = (value: unknown): value is `0x${string}` => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);

export function parseFollowBody(body: unknown): FollowRequest | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  for (const key of ["follower", "leader", "subaccount"] as const) {
    if (typeof b[key] !== "string" || !ADDRESS.test(b[key] as string)) return { error: `${key} must be an address` };
  }
  if (!wholeNumber(b.maxTradeSize)) return { error: "maxTradeSize must be a positive whole number of base units" };
  if (!wholeNumber(b.maxExposure)) return { error: "maxExposure must be a positive whole number of base units" };
  if (typeof b.maxLeverage !== "number" || !Number.isInteger(b.maxLeverage) || b.maxLeverage < 1 || b.maxLeverage > 10) {
    return { error: "maxLeverage must be a whole number from 1 to 10" };
  }
  let markets: string[] | null = null;
  if (b.markets !== null && b.markets !== undefined) {
    if (!Array.isArray(b.markets) || b.markets.length === 0 || b.markets.length > MAX_MARKETS || !b.markets.every((m) => typeof m === "string" && /^[A-Z0-9]{1,16}$/.test(m))) {
      return { error: "markets must be a short list of symbols, or null for all" };
    }
    markets = b.markets as string[];
  }
  if (typeof b.issuedAt !== "number" || !Number.isInteger(b.issuedAt) || b.issuedAt <= 0) return { error: "issuedAt must be unix seconds" };
  if (!hex(b.signature)) return { error: "signature must be a hex string" };
  const follower = (b.follower as string).toLowerCase();
  const leader = (b.leader as string).toLowerCase();
  const subaccount = (b.subaccount as string).toLowerCase();
  if (follower === leader) return { error: "a wallet cannot follow itself" };
  if (subaccount === leader) return { error: "the copy subaccount cannot be the leader" };
  return { follower, leader, subaccount, maxTradeSize: b.maxTradeSize, maxExposure: b.maxExposure, maxLeverage: b.maxLeverage, markets, issuedAt: b.issuedAt, signature: b.signature };
}

export function parseUnfollowBody(body: unknown): UnfollowRequest | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (typeof b.follower !== "string" || !ADDRESS.test(b.follower)) return { error: "follower must be an address" };
  if (typeof b.leader !== "string" || !ADDRESS.test(b.leader)) return { error: "leader must be an address" };
  if (typeof b.issuedAt !== "number" || !Number.isInteger(b.issuedAt) || b.issuedAt <= 0) return { error: "issuedAt must be unix seconds" };
  if (!hex(b.signature)) return { error: "signature must be a hex string" };
  return { follower: b.follower.toLowerCase(), leader: b.leader.toLowerCase(), issuedAt: b.issuedAt, signature: b.signature };
}

/// True when `signature` is `signer`'s EIP-191 signature over `message`. A signature that does not parse counts as a bad one.
export async function signedBy(signer: string, message: string, signature: `0x${string}`): Promise<boolean> {
  try {
    return (await recoverMessageAddress({ message, signature })).toLowerCase() === signer.toLowerCase();
  } catch {
    return false;
  }
}

export function withinWindow(issuedAt: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return Math.abs(nowSeconds - issuedAt) <= COPY_WINDOW_SECONDS;
}
