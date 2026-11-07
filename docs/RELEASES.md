# Releases

Mainnet opens in three releases, the ones on the landing roadmap. Each is a share of what the testnet already runs;
nothing in a release is new code. The ZENO token launches elsewhere on the day V1.0 opens mainnet, so V1.0 carries
it.

| Release | Opens on mainnet |
| --- | --- |
| V1.0 | Perpetuals, options, every listed market, ZENO (its address shown as CA), the fee share set aside for ZENO buybacks, portfolio, activity, alerts, leaderboard, PnL cards |
| V2.0 | Lending (lend USDG, borrow USDG against stocks), the options strategy builder, RFQ block trades |
| V3.0 | Copy trading, trader profiles (copy trading runs on subaccounts) |
| V3.1 | Ask Zeno, the read-only AI market assistant (not gated by `RELEASE`: on every network once deployed) |

## How a release is switched on

One number decides it: `RELEASE` in `/opt/zeno/mainnet/zeno.env` on the VPS (1, 2 or 3; unset or anything else
is 1). The testnet ignores it and always runs every release.

- **Site:** `deploy/vps-deploy.sh` passes it to the build as `NEXT_PUBLIC_RELEASE`. A feature from a later release
  has no menu entry, its page answers "Page not found", the How it works chapter keeps its demo without a link, the
  landing lending card says "Coming in V2.0", and the roadmap marks the release mainnet runs as "Live now".
- **API:** `services/api` serves the credit and RFQ routes from V2.0 and the copy routes from V3.0.
- **Keeper:** copies trades from V3.0.
- **Chain:** the release number does not reach the contracts. A feature is closed on chain by not deploying it yet
  (the lending stack, V2.0) or by its service key not acting yet (RFQ quotes, copy execution). `DeployAll` does
  deploy `ZenoSubaccountFactory` and `ZenoRFQManager` at V1.0: subaccounts can be created by calling the contract
  directly from V1.0 on, and an RFQ only fills with a quote signed by the `MAKER_ROLE` address.

The mapping lives in one place, `packages/config/src/releases.ts`. Changing which release a feature belongs to is a
one-line change there.

A release can be taken back: lower `RELEASE` and redeploy, and the site and the API hide the feature again. Funds
and positions already on chain stay where they are.

## Decide before V1.0

These are product and risk decisions; nothing below picks them for you.

- [ ] The settlement token: the mainnet USDG address (`COLLATERAL_TOKEN`).
- [ ] The deployer: a funded keystore (`--account zeno-mainnet`) and its address (`DEPLOYER`).
- [ ] The admin that takes over from the deployer: a multisig or timelock (`NEW_ADMIN`).
- [ ] The signing addresses: the option quoter (`QUOTER_ADDRESS`) and the RFQ market maker (`MAKER_ADDRESS`). Both
      default to the deployer, as on testnet, where the keeper and the pricing service sign with that key.
- [ ] The launch caps and the pool: `packages/contracts/deployments/robinhood_mainnet.limits.json` is sized for a pool
      of 4 USDG (`caps.poolReserveRaw`, base units). Size it to the USDG that will really fund the pool, in that
      file, before running `SetLaunchCaps` and `FundPool`.
- [ ] The buyback share of trading fees, in basis points (`BUYBACK_SHARE_BPS`, 0 to 10000).
- [ ] The ZENO token address and symbol.
- [ ] An audit, or a decision to open without one: `packages/config/src/chains.ts` calls the stack unaudited.

## V1.0: mainnet and ZENO

Run from `packages/contracts`. Every forge command is a dry run first; add `--broadcast --slow` to send it.

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com NETWORK_NAME=robinhood_mainnet DEPLOYER=0x...
SIGN=(--rpc-url "$RPC" --account zeno-mainnet --sender "$DEPLOYER")
```

1. **Deploy the stack.** A fresh `DeployAll`, so mainnet runs exactly the contracts tested on testnet (the earlier
   2026-09-25 deployment is not used). It writes `deployments/robinhood_mainnet.json`.

    ```bash
    COLLATERAL_TOKEN=0x...USDG MAKER_ADDRESS=0x... QUOTER_ADDRESS=0x... \
      forge script script/DeployAll.s.sol:DeployAll "${SIGN[@]}"
    ```

2. **List the markets** on the real stock tokens and Chainlink feeds of `deployments/robinhood_mainnet.markets.json`,
   then apply the launch caps from `robinhood_mainnet.limits.json`.

    ```bash
    MAX_POSITION=... OPEN_INTEREST_CAP=... MAX_PRICE_AGE_HOURS=25 forge script script/AddMarketsMainnet.s.sol "${SIGN[@]}"
    forge script script/SetLaunchCaps.s.sol "${SIGN[@]}"
    ```

3. **Fund the pool** with the reserve the limits file names (base units of USDG, held by the deployer).

    ```bash
    AMOUNT_RAW=$(jq .caps.poolReserveRaw deployments/robinhood_mainnet.limits.json) forge script script/FundPool.s.sol "${SIGN[@]}"
    ```

4. **Set aside the fee share for ZENO buybacks.** `DeployAll` leaves the share at 0 and the fee manager without a
   buyback module, so without these three calls no fee reaches the buyback.

    ```bash
    FEE=$(jq -r .feeManager deployments/robinhood_mainnet.json) BUYBACK=$(jq -r .buybackModule deployments/robinhood_mainnet.json)
    cast send "$FEE" "setBuybackModule(address)" "$BUYBACK" --rpc-url "$RPC" --account zeno-mainnet
    cast send "$FEE" "setBuybackShare(uint256)" "$BUYBACK_SHARE_BPS" --rpc-url "$RPC" --account zeno-mainnet
    cast send "$BUYBACK" "setProtocolToken(address)" 0x...ZENO --rpc-url "$RPC" --account zeno-mainnet
    ```

5. **Check, verify, hand over.**

    ```bash
    RPC_URL=$RPC MAX_POSITION=... MAX_OPEN_INTEREST=... MAX_NET_OPEN_INTEREST=... MAX_LEVERAGE=10 \
      ./script/check-launch-limits.sh robinhood_mainnet
    # verify.sh reads its RPC from ROBINHOOD_TESTNET_RPC_URL whatever the network (a historical name).
    ROBINHOOD_TESTNET_RPC_URL=$RPC EXPLORER_VERIFY_URL=https://robinhoodchain.blockscout.com/api ./script/verify.sh
    ```

    Then move the admin roles as `packages/contracts/README.md` ("Handing admin to a multisig or timelock")
    describes: grant to `NEW_ADMIN`, send one admin call from it, then renounce the deployer.

6. **Record the deployment** (repo root). This fills `robinhoodMainnetAddresses` and
   `robinhoodMainnetImplementations` in `packages/config/src/deployments.ts`, and mainnet becomes a deployed network
   for the site, the SDK and the services. Then update the test that pins mainnet as undeployed
   (`packages/config/src/deployments.test.ts`, "mainnet has no deployment until V1.0"), or the pre-push checks stop
   the push.

    ```bash
    node scripts/record-deployment.mjs robinhood_mainnet
    ```

7. **Set up the mainnet server** (once, on the VPS as root). `vps-setup.sh mainnet` writes `zeno.env` with
   `RELEASE=1`. Add the signing keys and the ZENO token to it:

    ```bash
    bash /opt/zeno/testnet/repo/deploy/vps-setup.sh mainnet
    # then in /opt/zeno/mainnet/zeno.env:
    #   KEEPER_PRIVATE_KEY=0x...   QUOTER_PRIVATE_KEY=0x...
    #   PROTOCOL_TOKEN_LIVE=true   PROTOCOL_TOKEN_ADDRESS=0x...ZENO   PROTOCOL_TOKEN_SYMBOL=ZENO
    ```

    The token can also launch after the site is live: `bash /opt/zeno/mainnet/repo/deploy/vps-token.sh mainnet 0x...ZENO`
    writes the same three lines, restarts only the web app and shows the CA in seconds, without a rebuild.

    Also add `KEEPER_REFRESH_FEEDS=false` (mainnet prices are Chainlink: the keeper has no feed of its own to keep
    alive) and `INDEXER_START_BLOCK=<the block of the first DeployAll transaction>` (otherwise the indexer starts at
    the chain head and misses the deployment). `vps-setup.sh` writes the Traefik route at once: park it
    (`/data/coolify/proxy/dynamic/zeno-mainnet.yaml`) until step 8 has passed on the internal ports, then retire the
    temporary apex redirect (`zeno-apex.yaml`) and put the mainnet route back. Done for V1.0 on 2026-11-06.

8. **Ship** (repo root): commit the recorded deployment, move it to the `mainnet` branch, deploy.

    ```bash
    git push origin main && git push origin main:testnet && git push origin main:mainnet
    ssh root@160.238.36.55 'bash /opt/zeno/mainnet/repo/deploy/vps-deploy.sh mainnet'
    ```

9. **Check** https://zenomarkets.tech: the ZENO address shows in the header, hero and footer; the menu has no
   Strategies, Lending or Copy trading; the roadmap marks V1.0 "Live now";
   `curl -o /dev/null -w '%{http_code}' https://zenomarkets.tech/v1/credit/markets` answers 404. Open a small
   position on a canary wallet, close it, and confirm a fee share arrived in the buyback module
   (`cast call "$BUYBACK" "accruedForBuyback(address)(uint256)" 0x...USDG --rpc-url "$RPC"`).

## V2.0: capital

Steps 1 to 3 run in one go from the repo root: `bash scripts/mainnet-v2.sh` (dry run), then `--broadcast`. It deploys
the pair open (`CREDIT_PAUSED=false`), opens the lending vault's deposits, checks `MAKER_ROLE` and records the
addresses. Then publish the sources to Sourcify (Blockscout shows them as verified; its own API sits behind a
Cloudflare challenge) and check: `cd packages/contracts && VERIFIER=sourcify NETWORK_NAME=robinhood_mainnet
ROBINHOOD_TESTNET_RPC_URL=$RPC ./script/verify.sh`, then `pnpm mainnet:verify`.

Open before V2.0: `HandOverAdmin.s.sol` does not move the lending stack's admin roles, so after step 1 below they
stay with the deployer key. Decide how they move (extend the script, or grant and renounce by hand) before opening.

1. **Deploy the lending stack** (TSLA collateral). It deploys paused unless `CREDIT_PAUSED=false`; its limits come
   from the `credit` key of `robinhood_mainnet.limits.json`.

    ```bash
    CREDIT_COLLATERAL_TOKEN=0x322F0929c4625eD5bAd873c95208D54E1c003b2d \
      forge script script/DeployCreditStack.s.sol "${SIGN[@]}"
    ```

2. **Record it** (repo root): `node scripts/record-deployment.mjs robinhood_mainnet`. With the credit addresses
   recorded, the keeper starts feeding the credit oracle on its own (`KEEPER_CREDIT_FEED=true` is already in
   `zeno.env`); the keeper key must be the oracle's feeder, which is the deployer that ran step 1.
3. **RFQ:** confirm the market maker that will quote holds `MAKER_ROLE` on `ZenoRFQManager`.
4. **Switch on:** set `RELEASE=2` in `/opt/zeno/mainnet/zeno.env`, push to `mainnet` and run
   `vps-deploy.sh mainnet` as in V1.0 step 8.
   **Seed the pair before anyone can borrow:** `bash scripts/mainnet-seed-credit.sh --broadcast`. The pair starts with
   no USDG, so every borrow reverts until it holds its `borrowCap`. The pair has no way to withdraw liquidity.
5. **Check:** the menu shows Lending and Strategies, not Copy trading; `/v1/credit/markets` answers 200; the roadmap
   marks V2.0 "Live now".

## V3.0: social

Nothing to deploy: the subaccount factory has been on chain since V1.0, and the keeper's own account is the copy
executor followers authorise.

0. **Prove it on testnet first** (same code, every release on): `FUNDER_KEY=<a funded testnet key> pnpm --filter
   @zeno/keeper copy:live-e2e` follows a fresh leader through the live API, and the running keeper must open the copy
   and close it again. It must end in `ALL PASS`.
1. **Point the API at the executor:** add `COPY_EXECUTOR_ADDRESS=<the keeper's address>` to
   `/opt/zeno/mainnet/zeno.env` (testnet has the same line).
2. **Switch on:** set `RELEASE=3`, push to `mainnet` and run `vps-deploy.sh mainnet`.
3. **Check:** the menu shows Copy trading; a trader's profile opens from the leaderboard;
   `/v1/copy/config` answers 200 with the executor address; the keeper log says `copy trading on`.

## V3.1: Ask Zeno

Nothing on chain and no `RELEASE` change: the assistant only reads, so it ships on testnet and mainnet together.
`docs/AI_ASSISTANT.md` has the details.

1. **Key:** add `LLM_API_KEY=<free-tier Groq key>` and `NEWS_API_URL=https://zenomarkets.tech` to
   `/opt/zeno/mainnet/zeno.env` (testnet: `NEWS_API_URL=https://testnet.zenomarkets.tech`). Without the key the panel
   says it is not switched on and the rest of the site is unchanged.
2. **Ship:** push to `testnet` and `mainnet`, run `vps-deploy.sh` for each.
3. **Check:** the round button shows on every app page (not the landing); a question on NVDA-PERP answers with
   sources and a risk line; `curl -s -X POST https://zenomarkets.tech/v1/ai/chat -H 'content-type: application/json'
   -d '{"messages":[{"role":"user","content":"hi"}]}'` answers 200.

## Known limits

- The site follows the release of the network it was built for. The testnet site, switched to mainnet in the
  network menu, still shows every feature; on mainnet those pages find no lending pair and no copy API and say so.
- A page that is not open yet answers "Page not found" with HTTP 200, not 404: the app streams its loading state
  before the page decides (the copy pages behaved this way before releases existed). It carries `noindex`.
