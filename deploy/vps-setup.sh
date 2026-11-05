#!/usr/bin/env bash
# One-time (idempotent) setup of one ZENOMARKETS network on the VPS. Run as root on the VPS:
#   bash vps-setup.sh testnet      (or mainnet)
# Creates the `zeno` user, a Postgres container bound to loopback, the git checkout of the network's branch,
# the root-only env file, the systemd units and the Traefik route (the Coolify proxy owns 80/443 and issues
# the Let's Encrypt certificates). Then hands over to vps-deploy.sh for install, migrate, build and start.
set -euo pipefail
NET="${1:?usage: vps-setup.sh testnet|mainnet}"
case "$NET" in
  testnet) WEB_PORT=3301 API_PORT=3302 PRICING_PORT=3303 DB_PORT=55921 CHAIN_ID=46630 HOST_NAME=testnet.zenomarkets.tech
           RPC=https://rpc.testnet.chain.robinhood.com EXPLORER=https://explorer.testnet.chain.robinhood.com ;;
  mainnet) WEB_PORT=3401 API_PORT=3402 PRICING_PORT=3403 DB_PORT=55931 CHAIN_ID=4663 HOST_NAME=zenomarkets.tech
           RPC=https://rpc.mainnet.chain.robinhood.com EXPLORER=https://robinhoodchain.blockscout.com ;;
  *) echo "unknown network $NET"; exit 1 ;;
esac
REPO_URL=https://github.com/Zeno-Markets/zenomarkets.git
BASE=/opt/zeno/$NET
ROUTE_DIR="${ROUTE_DIR:-/data/coolify/proxy/dynamic}"
BIND=172.16.0.1 # docker0: the Coolify proxy reaches the host through host.docker.internal

id zeno >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin zeno
mkdir -p "$BASE" && chown zeno:zeno /opt/zeno "$BASE"
[ -d "$BASE/repo/.git" ] || sudo -u zeno git clone --branch "$NET" "$REPO_URL" "$BASE/repo"

# Postgres, loopback only.
if [ ! -f "$BASE/db.env" ]; then
  umask 077; printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >"$BASE/db.env"
fi
if ! docker ps -a --format '{{.Names}}' | grep -qx "zeno-$NET-db"; then
  docker run -d --name "zeno-$NET-db" --restart unless-stopped --env-file "$BASE/db.env" -e POSTGRES_DB=zeno \
    -p "127.0.0.1:$DB_PORT:5432" -v "zeno-$NET-pg:/var/lib/postgresql/data" --memory 512m postgres:16-alpine
fi
set -a; . "$BASE/db.env"; set +a

# Root-only env shared by every service of this network. The signing key is the one deployer wallet; it is
# copied server-side from an existing env file the first time (KEY_SOURCE), never typed into a terminal log.
ENV="$BASE/zeno.env"
if [ ! -f "$ENV" ]; then
  umask 077
  cat >"$ENV" <<EOT
NETWORK=$NET
CHAIN_ID=$CHAIN_ID
RPC_URL=$RPC
DATABASE_URL=postgres://postgres:$POSTGRES_PASSWORD@127.0.0.1:$DB_PORT/zeno
API_PORT=$API_PORT
PRICING_PORT=$PRICING_PORT
PRICING_SERVICE_URL=http://127.0.0.1:$PRICING_PORT
API_URL=http://$BIND:$API_PORT
CORS_ORIGINS=https://zenomarkets.tech,https://testnet.zenomarkets.tech
EXTERNAL_CANDLE_HISTORY=true
KEEPER_CREDIT_FEED=true
KEEPER_INTERVAL_MS=20000
INDEXER_MAX_BLOCK_RANGE=5000
EOT
  # Mainnet opens at V1.0; raising RELEASE (and redeploying) opens the next release. Testnet ignores it.
  [ "$NET" = mainnet ] && echo "RELEASE=1" >>"$ENV"
  if [ -n "${KEY_SOURCE:-}" ] && [ -f "$KEY_SOURCE" ]; then
    key="$(grep -E '^KEEPER_PRIVATE_KEY=' "$KEY_SOURCE" | head -1 | cut -d= -f2-)"
    printf 'KEEPER_PRIVATE_KEY=%s\nQUOTER_PRIVATE_KEY=%s\n' "$key" "$key" >>"$ENV"; unset key
  fi
fi
grep -q '^KEEPER_PRIVATE_KEY=0x' "$ENV" || echo "NOTE: add KEEPER_PRIVATE_KEY and QUOTER_PRIVATE_KEY (the deployer key) to $ENV"

# systemd: one unit template per service, instance = network.
for svc in api indexer keeper pricing risk-monitor; do
  host=$BIND; [ "$svc" = pricing ] && host=127.0.0.1
  cat >"/etc/systemd/system/zeno-$svc@.service" <<EOT
[Unit]
Description=ZENOMARKETS $svc (%i)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=zeno
EnvironmentFile=/opt/zeno/%i/zeno.env
Environment=HOST=$host NODE_ENV=production
WorkingDirectory=/opt/zeno/%i/repo/services/$svc
ExecStart=/opt/zeno/%i/repo/node_modules/.bin/tsx src/index.ts
Restart=always
RestartSec=15
MemoryMax=500M

[Install]
WantedBy=multi-user.target
EOT
done
cat >/etc/systemd/system/zeno-web@.service <<'EOT'
[Unit]
Description=ZENOMARKETS web (%i)
After=network-online.target

[Service]
User=zeno
EnvironmentFile=/opt/zeno/%i/web.env
Environment=NODE_ENV=production
WorkingDirectory=/opt/zeno/%i/repo/apps/web
ExecStart=/opt/zeno/%i/repo/apps/web/node_modules/.bin/next start -H ${WEB_HOST} -p ${WEB_PORT}
Restart=always
RestartSec=10
MemoryMax=700M

[Install]
WantedBy=multi-user.target
EOT
printf 'WEB_HOST=%s\nWEB_PORT=%s\n' "$BIND" "$WEB_PORT" >"$BASE/web.env"
systemctl daemon-reload

# Mainnet's www host redirects to the apex, path kept. Served as its own site it broke every read: the API (/v1)
# lives on the apex only, so the browser blocked www's calls to it (CORS) and the page said "Could not read markets".
WWW_ROUTERS="" WWW_MIDDLEWARE=""
if [ "$NET" = mainnet ]; then
  WWW_ROUTERS=$(cat <<'EOT'
    zeno-mainnet-www-http:
      rule: Host(`www.zenomarkets.tech`)
      entryPoints: [http]
      middlewares: [zeno-mainnet-www]
      service: zeno-mainnet-web
    zeno-mainnet-www:
      rule: Host(`www.zenomarkets.tech`)
      entryPoints: [https]
      middlewares: [zeno-mainnet-www]
      service: zeno-mainnet-web
      tls:
        certResolver: letsencrypt
EOT
)
  WWW_MIDDLEWARE=$(cat <<'EOT'
    zeno-mainnet-www:
      redirectRegex:
        regex: '^https?://www\.zenomarkets\.tech/(.*)'
        replacement: 'https://zenomarkets.tech/${1}'
        permanent: true
EOT
)
fi
# Traefik route: /v1 goes to the API, everything else to the web app. One file per network.
cat >"$ROUTE_DIR/zeno-$NET.yaml" <<EOT
http:
  routers:
    zeno-$NET-http:
      rule: Host(\`$HOST_NAME\`)
      entryPoints: [http]
      middlewares: [zeno-$NET-https]
      service: zeno-$NET-web
    zeno-$NET-api:
      rule: (Host(\`$HOST_NAME\`)) && PathPrefix(\`/v1\`)
      entryPoints: [https]
      service: zeno-$NET-api
      priority: 100
      tls:
        certResolver: letsencrypt
    zeno-$NET-web:
      rule: Host(\`$HOST_NAME\`)
      entryPoints: [https]
      service: zeno-$NET-web
      tls:
        certResolver: letsencrypt
$WWW_ROUTERS
  middlewares:
    zeno-$NET-https:
      redirectScheme:
        scheme: https
        permanent: true
$WWW_MIDDLEWARE
  services:
    zeno-$NET-web:
      loadBalancer:
        servers:
          - url: http://host.docker.internal:$WEB_PORT
    zeno-$NET-api:
      loadBalancer:
        servers:
          - url: http://host.docker.internal:$API_PORT
EOT
echo "setup done for $NET; now: bash $BASE/repo/deploy/vps-deploy.sh $NET"
