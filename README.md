# ZENOMARKETS

**One view. A world of markets.**

Stocks, ETFs, crypto and commodities. Perps, options, lending and borrowing on Robinhood Chain, from one margin account.

- Testnet: <https://testnet.zenomarkets.tech> (Robinhood Chain Testnet, chain 46630)
- Mainnet: <https://zenomarkets.tech> (Robinhood Chain, chain 4663) from ZENOMARKETS V1.0
- X: [@UseZenoMarkets](https://x.com/UseZenoMarkets)

## Products

| Product | What it does | Contracts |
| --- | --- | --- |
| Perpetuals | Long or short up to 10x; market, limit, stop-loss, take-profit; isolated and cross margin; RFQ block trades | `ZenoPerpsEngine`, `ZenoPerpPositionManager`, `ZenoPerpOrderManager`, `ZenoFundingManager`, `ZenoLiquidationEngine`, `ZenoRFQManager` |
| Options | Cash-settled calls and puts, option chain with Greeks, strategy builder | `ZenoOptionsEngine`, `ZenoOptionMarket`, `ZenoOptionPositionManager` |
| Lending & borrowing | Borrow USDG against tokenized stocks; supply USDG to an ERC-4626 vault | `ZenoCreditPair`, `ZenoCreditVault`, `ZenoCreditRegistry`, `ZenoCreditRouter`, `ZenoCompositeSanityOracle` |
| Accounts | One vault, subaccounts, cross margin, copy trading | `ZenoVault`, `ZenoCollateralManager`, `ZenoSubaccountFactory`, `ZenoCrossMarginManager` |
| Risk & prices | Market registry, risk caps, oracle routing and validation, insurance fund, fees and buyback | `ZenoMarketRegistry`, `ZenoRiskManager`, `ZenoOracleRouter`, `ZenoPriceValidator`, `ZenoInsuranceFund`, `ZenoFeeManager`, `ZenoBuybackModule` |

Every product contract sits behind an ERC-1967 proxy with a UUPS upgrade path. Addresses per network are in
`packages/contracts/deployments/` and `packages/config/src/deployments.ts`.

## Repository

```text
apps/web            Next.js terminal and landing page (React 19, Tailwind 4, wagmi, viem, three.js)
services/api        REST + WebSocket API (Fastify)
services/indexer    Contract event indexer (PostgreSQL, Drizzle)
services/keeper     Limit and trigger orders, copy trading, credit price feed, testnet price feeds
services/pricing    Option pricing and signed quotes
services/risk-monitor  Margin health read path
packages/contracts  Solidity 0.8.26, Foundry, OpenZeppelin 5.1 (git submodules)
packages/sdk        @zeno/sdk, the typed client for the contracts and the API
packages/config     Chains, deployments, markets: the single source of configuration
packages/types      Shared TypeScript types
packages/ui         Shared UI primitives
deploy/             VPS setup and deploy scripts (systemd + Postgres + Traefik)
scripts/            Deploy, record and brand-check scripts
```

## Develop

```bash
git clone --recurse-submodules https://github.com/Zeno-Markets/zenomarkets.git
pnpm install
pnpm typecheck && pnpm lint && pnpm test
(cd packages/contracts && forge test)
pnpm --filter @zeno/web dev
```

## Branches

`main` is development. `testnet` and `mainnet` hold what runs on each network, with that network's deployment
record. Changes move `main` -> `testnet` -> `mainnet`. CI builds every branch.

## Deploy

- Contracts (testnet): `bash scripts/testnet-deploy.sh` (dry run), then `--broadcast`. Verify with
  `NETWORK_NAME=robinhood_testnet bash packages/contracts/script/verify.sh`.
- Services and web: `bash deploy/vps-setup.sh testnet` once on the VPS, then `bash deploy/vps-deploy.sh testnet`.

## License

MIT, see `LICENSE`.
