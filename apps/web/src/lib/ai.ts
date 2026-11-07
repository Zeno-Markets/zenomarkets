import { env } from "./env";

/// Ask Zeno, the browser half. It asks the API's `POST /v1/ai/chat` and nothing else: the assistant only reads, so it
/// needs no wallet and never reaches a signature. Pure helpers here, the sheet is `components/AiAssistant.tsx`.

export interface AiSource {
  tool: string;
  source: string;
  /// ISO time the data was observed.
  asOf: string;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  sources?: AiSource[];
}

/// What the API says went wrong. `rate_limited`, `busy` and `daily_limit` are the "limit reached" state.
export type AiFailure = "rate_limited" | "busy" | "daily_limit" | "timeout" | "unavailable" | "disabled" | "offline";

export class AiError extends Error {
  constructor(
    public readonly failure: AiFailure,
    public readonly retryAfterSeconds?: number,
  ) {
    super(failure);
  }
}

export const isLimit = (failure: AiFailure) => failure === "rate_limited" || failure === "busy" || failure === "daily_limit";

/// Plain words and a next step, never the server's or the provider's own text.
export function failureText(failure: AiFailure, retryAfterSeconds?: number): string {
  const wait = retryAfterSeconds && retryAfterSeconds < 120 ? ` Try again in ${Math.max(1, Math.round(retryAfterSeconds))} seconds.` : " Try again in a minute.";
  switch (failure) {
    case "rate_limited":
      return `You are asking too fast.${wait}`;
    case "busy":
      return `Zeno is busy helping others right now.${wait}`;
    case "daily_limit":
      return "Zeno has reached the limit for today. Come back tomorrow, or read the market page and the news in the meantime.";
    case "timeout":
      return "Zeno took too long to answer. Ask again, or ask something shorter.";
    case "disabled":
      return "Zeno is not switched on yet. The rest of the app works as usual.";
    case "offline":
      return "You are offline. Reconnect and ask again.";
    default:
      return "Zeno could not answer right now. Try again soon.";
  }
}

export const suggestions = (symbol: string): string[] => [`Why is ${symbol} moving today?`, `What are the risks of trading ${symbol}?`, "Explain funding rate"];

const FAILURES: readonly string[] = ["rate_limited", "busy", "daily_limit", "timeout", "unavailable", "disabled"];

/// "14:05 UTC, 14 Oct": the time a source's data was observed, in UTC so it reads the same everywhere.
export function fmtSourceTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "time unknown";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${time} UTC, ${day}`;
}

/// One question to the assistant. The API keeps only the last six messages, so only those are sent.
export async function askAi(symbol: string, messages: AiMessage[]): Promise<{ answer: string; sources: AiSource[] }> {
  if (!env.apiUrl) throw new AiError("disabled");
  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}/v1/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: symbol || undefined, messages: messages.slice(-6).map(({ role, content }) => ({ role, content })) }),
    });
  } catch {
    throw new AiError("offline");
  }
  const body = (await response.json().catch(() => null)) as { answer?: string; sources?: AiSource[]; code?: string; retryAfterSeconds?: number } | null;
  if (response.ok && typeof body?.answer === "string") return { answer: body.answer, sources: body.sources ?? [] };
  // A 504 from the host (an idle serverless API) has no code of ours: it is a timeout, not a fault in the question.
  throw new AiError(FAILURES.includes(body?.code ?? "") ? (body!.code as AiFailure) : response.status === 504 ? "timeout" : "unavailable", body?.retryAfterSeconds);
}
