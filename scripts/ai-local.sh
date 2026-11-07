#!/usr/bin/env bash
# Runs Ask Zeno on this machine: a scratch Postgres on :55432, the API on :4000 (testnet chain 46630, public RPC),
# and the web dev server on :3000. The model key is read from YOUR shell, never from a file:
#
#   export LLM_API_KEY=...            # a free-tier key, no card (docs/AI_ASSISTANT.md)
#   bash scripts/ai-local.sh up       # then open http://localhost:3000/perpetuals?market=NVDA
#   bash scripts/ai-local.sh down
#
# Optional: LLM_BASE_URL, LLM_MODEL. AI_DEBUG=true is set so `MODE=real node scripts/e2e-ai.mjs` can check numbers.
# The scratch database has the schema but no indexed prices, so the "24h change" is empty locally; prices, funding,
# candles (past history), levels, news and the glossary are real.
set -euo pipefail
cd "$(dirname "$0")/.."
RUN=.ai-local
PGPORT=55432
DB="postgres://postgres@127.0.0.1:$PGPORT/zeno_ai"
TESTNET_RPC=https://rpc.testnet.chain.robinhood.com

case "${1:-}" in
  up)
    [ -n "${LLM_API_KEY:-}" ] || echo "note: LLM_API_KEY is not set in this shell, so the assistant will answer 'not switched on yet'."
    mkdir -p $RUN
    if [ ! -d $RUN/pg ]; then initdb -D $RUN/pg -U postgres --auth=trust >/dev/null; fi
    pg_ctl -D $RUN/pg -o "-p $PGPORT -k /tmp -c listen_addresses=127.0.0.1" -l $RUN/pg.log -w start >/dev/null || true
    psql -h 127.0.0.1 -p $PGPORT -U postgres -tc "select 1 from pg_database where datname='zeno_ai'" | grep -q 1 || psql -h 127.0.0.1 -p $PGPORT -U postgres -qc "create database zeno_ai"
    DATABASE_URL=$DB pnpm --filter @zeno/indexer db:migrate >/dev/null

    CHAIN_ID=46630 RPC_URL=$TESTNET_RPC DATABASE_URL=$DB API_PORT=4000 \
      NEWS_API_URL=${NEWS_API_URL:-https://testnet.zenomarkets.tech} AI_DEBUG=true AI_RATE_PER_MINUTE=60 AI_RATE_BURST=20 \
      LLM_API_KEY="${LLM_API_KEY:-}" LLM_BASE_URL="${LLM_BASE_URL:-}" LLM_MODEL="${LLM_MODEL:-}" \
      nohup pnpm --filter @zeno/api start >$RUN/api.log 2>&1 &
    echo $! >$RUN/api.pid
    NEXT_PUBLIC_CHAIN_ID=46630 NEXT_PUBLIC_RPC_URL=$TESTNET_RPC \
      NEXT_PUBLIC_API_URL=http://localhost:4000 NEXT_PUBLIC_API_URL_TESTNET=http://localhost:4000 \
      nohup pnpm --filter @zeno/web dev >$RUN/web.log 2>&1 &
    echo $! >$RUN/web.pid
    for _ in $(seq 1 60); do curl -sf http://localhost:4000/health >/dev/null 2>&1 && break; sleep 1; done
    curl -sf http://localhost:4000/health >/dev/null && echo "API up:  http://localhost:4000   (log $RUN/api.log)" || { echo "API did not start, see $RUN/api.log"; exit 1; }
    echo "Web:     http://localhost:3000/perpetuals?market=NVDA   (log $RUN/web.log, first load compiles for ~20 s)"
    ;;
  down)
    for name in api web; do [ -f $RUN/$name.pid ] && pkill -P "$(cat $RUN/$name.pid)" 2>/dev/null; [ -f $RUN/$name.pid ] && kill "$(cat $RUN/$name.pid)" 2>/dev/null; rm -f $RUN/$name.pid; done
    pkill -f "next dev" 2>/dev/null || true
    pg_ctl -D $RUN/pg stop >/dev/null 2>&1 || true
    echo "stopped (database kept in $RUN/pg)"
    ;;
  *) echo "usage: bash scripts/ai-local.sh up|down"; exit 2 ;;
esac
