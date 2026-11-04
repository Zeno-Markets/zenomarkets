# Changelog

## [1.0.0-testnet]

- First ZENOMARKETS stack on Robinhood Chain Testnet: 20 core contracts behind ERC-1967 proxies (UUPS), the credit
  stack (TSLA / USDG pair, ERC-4626 vault, registry, router, sanity oracle) and the testnet assets
  (`ZenoTestToken` USDG and market tokens, `ZenoTestnetFeed` price feeds that follow the real instrument).
- 21 markets: stocks, ETFs, crypto and commodities.
- Addresses: `deployments/robinhood_testnet.json`, implementations in `deployments/robinhood_testnet.implementations.json`.
