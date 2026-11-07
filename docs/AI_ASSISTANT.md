# Ask Zeno, the market assistant (V3.1)

A read-only explainer. It answers from ZENOMARKETS' own data, cites each source with the time of the data, and has no tool
that can write, sign or send. It needs no wallet. Cost: $0 by construction (free-tier key, no card, caps below).

## What it is

- `POST /v1/ai/chat` in `services/api` (`src/routes/ai.ts`, `src/ai.ts`). Body `{ symbol?, messages[] }`. Roles are
  `user` and `assistant` only. History is cut to the last 6 messages of at most 2,000 characters.
- Answer `{ answer, sources: [{ tool, source, asOf }] }`. The sheet shows each source and its UTC time under the answer.
- The model runs a tool loop on the server: at most **4 tool rounds** and **15 seconds** in total. After round 4 it gets
  no tools and must answer.
- Tools (all read-only, all return `{ source, asOf, data }`):

| Tool | Reads |
| --- | --- |
| `get_market_snapshot(symbol)` | `/v1/prices/:symbol`, `/v1/markets/stats`, `/v1/perps/:symbol/funding`. A closed, stale or paused market is reported as not live, with its last close from the Robinhood reference quote |
| `get_candles(symbol, interval, limit)` | `/v1/prices/:symbol/candles`, at most 48 candles |
| `get_levels(symbol)` | Support and resistance computed in code (`computeLevels`: pivot highs and lows, 3 bars each side, clustered within 0.5%). The model only explains them |
| `get_news(symbol or category)` | Market News (`/api/news` on the web app, at `NEWS_API_URL`) |
| `explain_term(term)` | `GLOSSARY` in `packages/config/src/glossary.ts`, the same words the page shows |
| `list_markets(group?, query?)` | `@zeno/config` market list, at most 40 rows |

- The system prompt is a constant (`SYSTEM_PROMPT`). The open market, the user's words and every tool result travel as
  `user` or `tool` messages, so a headline that says "ignore your instructions" is only data. Rules: answer only from
  tool data, say a missing number is unavailable, no price targets and no buy or sell advice, a risk line to finish
  (the code adds one if the model forgets), refuse transactions, reply in Indonesian or English, plain text.

## Limits and errors

| Case | Status | `code` | Notes |
| --- | --- | --- | --- |
| No `LLM_API_KEY` | 503 | `disabled` | The sheet says it is not switched on |
| Bad body, `system` or `tool` role, unlisted market | 400 | `bad_request` | Costs no daily request |
| Per address | 429 | `rate_limited` | `RateLimiter`, `AI_RATE_PER_MINUTE` (6) and `AI_RATE_BURST` (4). Key: last `x-forwarded-for` entry |
| Everyone, per UTC day | 429 | `daily_limit` | `AI_DAILY_CAP`, default 300, in memory (a restart resets it) |
| Provider 429, 402 or 503 | 503 | `busy` | `Retry-After` from the provider, capped at 1 hour. The provider's text never reaches the client |
| Over 15 s | 504 | `timeout` | |
| Anything else from the provider | 502 | `unavailable` | Only the status code is logged. The key is never logged |

## Set it up (about 3 minutes, $0)

1. **Groq** (default). Sign up at console.groq.com with an email, **do not add a card**. Create an API key.
   Groq documents tool use for every model it hosts; `openai/gpt-oss-120b` is the default (`llama-3.3-70b-versatile` was the first choice and Groq withdrew it: a 404 `model_not_found`, so the sheet said "could not answer right now". `GET https://api.groq.com/openai/v1/models` with your key lists what your account can use; set `LLM_MODEL` if the default is ever retired).
   Gemini works too: a key from aistudio.google.com (free tier, no billing), `LLM_BASE_URL`
   `https://generativelanguage.googleapis.com/v1beta/openai`, `LLM_MODEL` `gemini-2.5-flash`.
   Free-tier limits change; read the provider's page before raising `AI_DAILY_CAP`. A free tier also has a tokens-per-minute
   cap (8,000 on Groq's gpt-oss models; a burst of questions in one minute is answered "busy"); tool results are kept small for that reason.
2. **VPS**: add to `/opt/zeno/mainnet/zeno.env` (and `/opt/zeno/testnet/zeno.env`) `LLM_API_KEY=<the key>` and
   `NEWS_API_URL=https://zenomarkets.tech` (testnet: `https://testnet.zenomarkets.tech`). Optional: `LLM_BASE_URL`,
   `LLM_MODEL`, `AI_DAILY_CAP`. Never put the key in a file in the repo or in a commit; the web build never sees it
   (`vps-deploy.sh` passes only `NEXT_PUBLIC_*` values to the build).
3. Restart the API (`systemctl restart zeno-api@mainnet`, or a full `vps-deploy.sh mainnet`).
   `curl -s -X POST https://zenomarkets.tech/v1/ai/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"hi"}]}'`
   answers 200 with text, or 503 `disabled` if the key is missing.

## The end-to-end run

```bash
bash scripts/ai-local.sh up                     # local API on :4000 and web on :3000, testnet chain
PLAYWRIGHT_DIR=~/.npm/_npx/<hash> node scripts/e2e-ai.mjs [screens-dir]            # every state of the panel, scripted answers
MODE=real API_URL=http://localhost:4000 PLAYWRIGHT_DIR=... node scripts/e2e-ai.mjs  # the real API and model
API=http://localhost:4000 node scripts/ai-battery.mjs                               # 29 API cases with the real model
```

`MODE=real` asks "Why is NVDA down today?" on NVDA-PERP at 375 px and 1440 px, checks each source line has a UTC time,
the answer ends with a risk line, and **every number in the answer is a number in a tool payload** (needs `AI_DEBUG=true`
on the API, which `ai-local.sh` sets; never set it on mainnet).

## Try it on this machine

```bash
export LLM_API_KEY=<your free key>      # this shell only
bash scripts/ai-local.sh up             # scratch Postgres, API on :4000, web on :3000
# open http://localhost:3000/perpetuals?market=NVDA and click the Ask Zeno button
bash scripts/ai-local.sh down
```

If the sheet says "could not answer right now", read `.ai-local/api.log`: the line `api: ai provider answered <status>` names the provider's status (404 means a wrong model or base URL, 401 a bad key, 429 a quota).
