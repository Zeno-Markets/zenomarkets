import { fetchReferenceQuotes } from "@zeno/sdk";
import type { FastifyInstance } from "fastify";
import { DailyCap, LlmError, makeTools, parseChat, runChat, type ChatRequest, type ChatResult, type LlmConfig, type ToolDeps } from "../ai.js";
import { RateLimiter } from "../rfq.js";

export interface AiRouteOptions {
  /// Read from `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` when omitted. No key, no assistant (503 `disabled`).
  llm?: LlmConfig | null;
  deps?: ToolDeps;
  limiter?: RateLimiter;
  dailyCap?: DailyCap;
  timeoutMs?: number;
  now?: () => number;
}

/// The default model must support tool calling on the provider's free tier with no card. Groq documents tool use for
/// every model it hosts. `llama-3.3-70b-versatile` was the first choice and Groq withdrew it (a 404 `model_not_found`
/// on 2026-10-15, absent from `GET /models`), so the default is `openai/gpt-oss-120b`, which Groq's tool-use page lists
/// and which is on its free plan. Gemini's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`,
/// model `gemini-2.5-flash`) works the same way. A provider can retire a model: `LLM_MODEL` changes it with no deploy.
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

function llmFromEnv(): LlmConfig | null {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  return { apiKey, baseUrl: process.env.LLM_BASE_URL || DEFAULT_BASE_URL, model: process.env.LLM_MODEL || DEFAULT_MODEL };
}

/// The caller's address. The API sits behind the VPS's Traefik proxy, so `request.ip` is the proxy; the last
/// `x-forwarded-for` entry is the one the proxy itself appended, which a client cannot forge.
const clientIp = (request: { ip: string; headers: Record<string, string | string[] | undefined> }) => {
  const forwarded = request.headers["x-forwarded-for"];
  const chain = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return chain[chain.length - 1] ?? request.ip;
};

function depsFor(app: FastifyInstance): ToolDeps {
  return {
    async get(path) {
      const response = await app.inject({ method: "GET", url: path });
      let body: unknown = null;
      try {
        body = response.json();
      } catch {
        // A non-JSON answer is a failure the tool reports.
      }
      return { status: response.statusCode, body };
    },
    async referenceQuote(symbol) {
      return (await fetchReferenceQuotes([symbol], process.env.QUOTE_API_URL ? { url: process.env.QUOTE_API_URL } : {})).get(symbol);
    },
    async news(ticker) {
      const base = process.env.NEWS_API_URL;
      if (!base) return undefined;
      try {
        const response = await fetch(`${base.replace(/\/$/, "")}/api/news${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`, { signal: AbortSignal.timeout(6_000) });
        return response.ok ? ((await response.json()) as Awaited<ReturnType<ToolDeps["news"]>>) : undefined;
      } catch {
        return undefined;
      }
    },
    async docs(topic) {
      const base = process.env.NEWS_API_URL;
      if (!base) return undefined;
      if (!docsPage || Date.now() - docsPage.at > DOCS_TTL_MS) {
        try {
          const response = await fetch(`${base.replace(/\/$/, "")}/docs`, { signal: AbortSignal.timeout(6_000) });
          if (!response.ok) return undefined;
          docsPage = { html: await response.text(), at: Date.now() };
        } catch {
          return undefined;
        }
      }
      const text = docsSection(docsPage.html, topic);
      return text ? { text, asOf: new Date(docsPage.at).toISOString() } : undefined;
    },
    now: () => new Date(),
  };
}

const DOCS_TTL_MS = 10 * 60_000;
let docsPage: { html: string; at: number } | undefined;

/// The text of `<section id="topic">` in the rendered Docs page: tags dropped, entities the page uses decoded.
export function docsSection(html: string, topic: string): string | undefined {
  const match = html.match(new RegExp(`<section[^>]*\\bid="${topic}"[^>]*>([\\s\\S]*?)</section>`));
  if (!match) return undefined;
  const text = match[1]!
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/// The first question of a conversation repeats (the starter chips): the same question on the same market within
/// two minutes gets the same answer, and asks arriving together share one model call. Answers carry the time of
/// their data, so a cached one never claims to be newer. A follow-up depends on its history and is never cached.
export const ANSWER_CACHE_MS = 2 * 60_000;
const ANSWER_CACHE_MAX = 200;
export const answerKey = (request: ChatRequest) =>
  request.messages.length === 1 ? `${request.symbol ?? ""}|${request.messages[0]!.content.toLowerCase().replace(/\s+/g, " ").replace(/[\s?!.]+$/, "").trim()}` : undefined;

/// `POST /v1/ai/chat`: Ask Zeno. Read-only by construction: the tools only read, and nothing in this file can sign,
/// send or prepare a transaction. It needs no wallet. Free by construction too: the key comes from a provider account
/// with no card, a per-IP bucket and a daily cap keep the traffic under that account's quota, and a provider 429 is
/// shown as "busy", never passed through.
export function registerAiRoutes(app: FastifyInstance, options: AiRouteOptions = {}) {
  const now = options.now ?? Date.now;
  const limiter = options.limiter ?? new RateLimiter(Number(process.env.AI_RATE_PER_MINUTE ?? 6) / 60, Number(process.env.AI_RATE_BURST ?? 4), now);
  // ponytail: well below Groq's free 1,000 a day; raise AI_DAILY_CAP only after reading the provider's current limits.
  const dailyCap = options.dailyCap ?? new DailyCap(Number(process.env.AI_DAILY_CAP ?? 300), now);
  const debug = process.env.AI_DEBUG === "true";
  const answers = new Map<string, { at: number; result: Promise<ChatResult> }>();

  app.post<{ Body: unknown }>("/v1/ai/chat", async (request, reply) => {
    const llm = options.llm === undefined ? llmFromEnv() : options.llm;
    if (!llm) return reply.code(503).send({ code: "disabled", error: "Zeno is not switched on yet." });

    const parsed = parseChat(request.body);
    if ("error" in parsed) return reply.code(400).send({ code: "bad_request", error: parsed.error });

    if (!limiter.allow(clientIp(request))) {
      return reply.code(429).header("retry-after", "15").send({ code: "rate_limited", error: "You are asking too fast. Wait a moment and try again.", retryAfterSeconds: 15 });
    }
    const key = answerKey(parsed);
    const hit = key === undefined ? undefined : answers.get(key);
    let pending: Promise<ChatResult>;
    if (hit && now() - hit.at < ANSWER_CACHE_MS) {
      pending = hit.result;
    } else {
      // Only a model call counts against the daily cap; a cached answer costs the provider nothing.
      if (!dailyCap.take()) {
        const wait = dailyCap.retryAfterSeconds();
        return reply.code(429).header("retry-after", String(wait)).send({ code: "daily_limit", error: "Zeno has reached the limit for today. Try again tomorrow.", retryAfterSeconds: wait });
      }
      pending = runChat({ config: llm, tools: makeTools(options.deps ?? depsFor(app)), request: parsed, timeoutMs: options.timeoutMs });
      if (key !== undefined) {
        const entry = { at: now(), result: pending };
        answers.delete(key);
        answers.set(key, entry);
        // A failure is not kept: the next ask tries the model again.
        pending.catch(() => answers.get(key) === entry && answers.delete(key));
        for (const [old, value] of answers) if (answers.size > ANSWER_CACHE_MAX || now() - value.at >= ANSWER_CACHE_MS) answers.delete(old);
      }
    }

    try {
      const result = await pending;
      request.log.info({ rounds: result.rounds, tools: result.sources.map((source) => source.tool), cached: pending === hit?.result }, "ai chat");
      return { answer: result.answer, sources: result.sources, ...(debug ? { debug: { payloads: result.payloads } } : {}) };
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      request.log.warn({ kind: error.kind }, "ai chat failed");
      if (error.kind === "busy") {
        const wait = error.retryAfter ?? 30;
        return reply.code(503).header("retry-after", String(wait)).send({ code: "busy", error: "Zeno is busy. Try again in a minute.", retryAfterSeconds: wait });
      }
      if (error.kind === "timeout") return reply.code(504).send({ code: "timeout", error: "Zeno took too long to answer. Try again." });
      return reply.code(502).send({ code: "unavailable", error: "Zeno could not answer right now. Try again soon." });
    }
  });
}
