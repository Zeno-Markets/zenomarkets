# Changelog

## [1.0.0] - 2026-11-06

- ZENOMARKETS V1.0 on Robinhood Chain mainnet (4663), a fresh `DeployAll` by `scripts/mainnet-v1.sh`: 21 contracts behind
  ERC-1967 proxies (UUPS) on the real USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`). Vault `0x47CA1A365Db33f8B0949289437aD635bbFb8b70F`.
- 39 markets on the real stock tokens and Chainlink feeds (`deployments/robinhood_mainnet.markets.json`), under the
  launch caps of `deployments/robinhood_mainnet.limits.json`, halved for a 2 USDG pool: 0.1 USDG per position.
- Pool funded with 2 USDG. 10% of each fee goes to `ZenoBuybackModule`; its protocol token (ZENO) is set once it launches.
- Not deployed until V2.0: the credit stack. Every admin role is still the deployer's (`HandOverAdmin.s.sol` not run yet).
- Addresses: `deployments/robinhood_mainnet.json`, implementations in `deployments/robinhood_mainnet.implementations.json`.

## [1.0.0-testnet]

- First ZENOMARKETS stack on Robinhood Chain Testnet: 20 core contracts behind ERC-1967 proxies (UUPS), the credit
  stack (TSLA / USDG pair, ERC-4626 vault, registry, router, sanity oracle) and the testnet assets
  (`ZenoTestToken` USDG and market tokens, `ZenoTestnetFeed` price feeds that follow the real instrument).
- 21 markets: stocks, ETFs, crypto and commodities.
- Addresses: `deployments/robinhood_testnet.json`, implementations in `deployments/robinhood_testnet.implementations.json`.
