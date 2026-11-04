// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console} from "forge-std/console.sol";

import {StackScript} from "./utils/StackScript.sol";

import {ZenoMarketRegistry} from "../src/core/ZenoMarketRegistry.sol";
import {ZenoCollateralManager} from "../src/core/ZenoCollateralManager.sol";
import {ZenoVault} from "../src/core/ZenoVault.sol";
import {ZenoFeeManager} from "../src/core/ZenoFeeManager.sol";
import {ZenoBuybackModule} from "../src/core/ZenoBuybackModule.sol";
import {ZenoPriceValidator} from "../src/oracle/ZenoPriceValidator.sol";
import {ZenoOracleRouter} from "../src/oracle/ZenoOracleRouter.sol";
import {ZenoRiskManager} from "../src/risk/ZenoRiskManager.sol";
import {ZenoOptionPositionManager} from "../src/options/ZenoOptionPositionManager.sol";
import {ZenoOptionMarket} from "../src/options/ZenoOptionMarket.sol";
import {ZenoOptionsEngine} from "../src/options/ZenoOptionsEngine.sol";
import {ZenoPerpPositionManager} from "../src/perps/ZenoPerpPositionManager.sol";
import {ZenoPerpOrderManager} from "../src/perps/ZenoPerpOrderManager.sol";
import {ZenoInsuranceFund} from "../src/core/ZenoInsuranceFund.sol";
import {ZenoCrossMarginManager} from "../src/risk/ZenoCrossMarginManager.sol";
import {ZenoSubaccountFactory} from "../src/accounts/ZenoSubaccountFactory.sol";
import {ZenoRFQManager} from "../src/perps/ZenoRFQManager.sol";
import {ZenoFundingManager} from "../src/perps/ZenoFundingManager.sol";
import {ZenoPerpsEngine} from "../src/perps/ZenoPerpsEngine.sol";
import {ZenoLiquidationEngine} from "../src/perps/ZenoLiquidationEngine.sol";

/// @notice Deploys the full Phase 1 contract stack behind ERC-1967 proxies, in dependency order, wires
/// every AccessControl role, and writes the proxy addresses to `deployments/<network>.json` and the
/// implementation addresses to `deployments/<network>.implementations.json`. Reads the deployer key
/// from `PRIVATE_KEY` and the settlement collateral token from `COLLATERAL_TOKEN` env vars.
///
/// The proxy addresses are the ones every client uses, and they never change. This script is for the
/// first deployment (or a deliberate fresh start). To ship a contract change without changing an
/// address or losing state, run `UpgradeAll.s.sol` instead.
///
/// Usage (testnet, once chain ID/RPC/deployer key are available):
///   forge script script/DeployAll.s.sol --rpc-url robinhood_testnet --broadcast --verify
///
/// Usage (local dry run against Anvil, no env vars needed beyond Anvil's default key):
///   anvil &
///   forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployAll is StackScript {
    function run() external returns (Stack memory d) {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address admin = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);
        address settlementToken = vm.envOr("COLLATERAL_TOKEN", address(0));
        require(settlementToken != address(0), "COLLATERAL_TOKEN env var not set");

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        Impls memory impls;
        (d, impls) = _deployStack(admin, settlementToken);

        // RFQ and block trades: the engine only opens at a quoted price for this manager. The maker
        // role goes to the market maker's signing address (default: the deployer, for local runs).
        ZenoPerpsEngine(d.perpsEngine).setRfqManager(d.rfqManager);
        ZenoRFQManager rfq = ZenoRFQManager(d.rfqManager);
        rfq.grantRole(rfq.MAKER_ROLE(), vm.envOr("MAKER_ADDRESS", admin));

        _wireRoles(d);

        // The quoter signs option premiums (see IOptionsEngine.Quote), so it is a critical key:
        // set QUOTER_ADDRESS to the pricing service's signing address, and move the role behind a
        // multisig before mainnet. Defaults to the deployer for local runs.
        address quoter = vm.envOr("QUOTER_ADDRESS", admin);
        ZenoOptionsEngine optionsEngine = ZenoOptionsEngine(d.optionsEngine);
        optionsEngine.grantRole(optionsEngine.QUOTER_ROLE(), quoter);
        console.log("Option quoter:         ", quoter);

        vm.stopBroadcast();

        _writeDeploymentFile(d);
        _writeImplementationsFile(impls, _network("localhost"));
        _logSummary(d);
    }

    function _wireRoles(Stack memory d) internal {
        _wireVaultAndCollateral(d);
        _wireFeesAndRisk(d);
        _wirePositionManagers(d);
        _wireFundingAndOracle(d);
    }

    function _wireVaultAndCollateral(Stack memory d) internal {
        ZenoCollateralManager cm = ZenoCollateralManager(d.collateralManager);
        ZenoVault vault = ZenoVault(d.vault);

        cm.grantRole(cm.VAULT_ROLE(), d.vault);
        cm.addSupportedToken(d.settlementToken);

        bytes32 vaultEngineRole = vault.ENGINE_ROLE();
        vault.grantRole(vaultEngineRole, d.optionsEngine);
        vault.grantRole(vaultEngineRole, d.perpsEngine);
        vault.grantRole(vaultEngineRole, d.liquidationEngine);
        vault.grantRole(vaultEngineRole, d.fundingManager);
        vault.grantRole(vault.FEE_MANAGER_ROLE(), d.feeManager);

        // Account-level margin: the cross-margin manager seizes collateral through the Vault, and
        // the Vault asks it before every withdrawal.
        vault.grantRole(vaultEngineRole, d.crossMargin);
        vault.setWithdrawGuard(d.crossMargin);
        ZenoCrossMarginManager cross = ZenoCrossMarginManager(d.crossMargin);
        cross.grantRole(cross.ENGINE_ROLE(), d.perpsEngine);
        cross.grantRole(cross.LIQUIDATOR_ROLE(), d.liquidationEngine);

        // A subaccount may call the trading engines, never the Vault or a token.
        ZenoSubaccountFactory factory = ZenoSubaccountFactory(d.subaccountFactory);
        factory.setTargetAllowed(d.perpsEngine, true);
        factory.setTargetAllowed(d.optionsEngine, true);
    }

    function _wireFeesAndRisk(Stack memory d) internal {
        ZenoFeeManager feeManager = ZenoFeeManager(d.feeManager);
        ZenoBuybackModule buyback = ZenoBuybackModule(d.buybackModule);
        ZenoRiskManager riskManager = ZenoRiskManager(d.riskManager);

        bytes32 feeEngineRole = feeManager.ENGINE_ROLE();
        feeManager.grantRole(feeEngineRole, d.optionsEngine);
        feeManager.grantRole(feeEngineRole, d.perpsEngine);
        feeManager.grantRole(feeEngineRole, d.liquidationEngine);
        buyback.grantRole(buyback.FEE_MANAGER_ROLE(), d.feeManager);

        bytes32 riskEngineRole = riskManager.ENGINE_ROLE();
        riskManager.grantRole(riskEngineRole, d.optionsEngine);
        riskManager.grantRole(riskEngineRole, d.perpsEngine);
        riskManager.grantRole(riskEngineRole, d.liquidationEngine);
    }

    function _wirePositionManagers(Stack memory d) internal {
        ZenoOptionPositionManager opm = ZenoOptionPositionManager(d.optionPositionManager);
        ZenoOptionMarket om = ZenoOptionMarket(d.optionMarket);
        ZenoPerpPositionManager ppm = ZenoPerpPositionManager(d.perpPositionManager);
        ZenoPerpOrderManager pom = ZenoPerpOrderManager(d.perpOrderManager);

        opm.grantRole(opm.ENGINE_ROLE(), d.optionsEngine);
        om.grantRole(om.ENGINE_ROLE(), d.optionsEngine);

        bytes32 perpEngineRole = ppm.ENGINE_ROLE();
        ppm.grantRole(perpEngineRole, d.perpsEngine);
        ppm.grantRole(perpEngineRole, d.fundingManager);
        ppm.grantRole(perpEngineRole, d.liquidationEngine);
        pom.grantRole(pom.ENGINE_ROLE(), d.perpsEngine);
    }

    function _wireFundingAndOracle(Stack memory d) internal {
        ZenoFundingManager fundingManager = ZenoFundingManager(d.fundingManager);
        ZenoOracleRouter oracleRouter = ZenoOracleRouter(d.oracleRouter);

        bytes32 fundingEngineRole = fundingManager.ENGINE_ROLE();
        fundingManager.grantRole(fundingEngineRole, d.perpsEngine);
        fundingManager.grantRole(fundingEngineRole, d.liquidationEngine);

        bytes32 oracleEngineRole = oracleRouter.ENGINE_ROLE();
        oracleRouter.grantRole(oracleEngineRole, d.perpsEngine);
        oracleRouter.grantRole(oracleEngineRole, d.liquidationEngine);
    }

    function _writeDeploymentFile(Stack memory d) internal {
        string memory json = "deployment";
        vm.serializeAddress(json, "marketRegistry", d.marketRegistry);
        vm.serializeAddress(json, "collateralManager", d.collateralManager);
        vm.serializeAddress(json, "vault", d.vault);
        vm.serializeAddress(json, "feeManager", d.feeManager);
        vm.serializeAddress(json, "buybackModule", d.buybackModule);
        vm.serializeAddress(json, "priceValidator", d.priceValidator);
        vm.serializeAddress(json, "oracleRouter", d.oracleRouter);
        vm.serializeAddress(json, "riskManager", d.riskManager);
        vm.serializeAddress(json, "optionPositionManager", d.optionPositionManager);
        vm.serializeAddress(json, "optionMarket", d.optionMarket);
        vm.serializeAddress(json, "optionsEngine", d.optionsEngine);
        vm.serializeAddress(json, "perpPositionManager", d.perpPositionManager);
        vm.serializeAddress(json, "perpOrderManager", d.perpOrderManager);
        vm.serializeAddress(json, "fundingManager", d.fundingManager);
        vm.serializeAddress(json, "perpsEngine", d.perpsEngine);
        vm.serializeAddress(json, "liquidationEngine", d.liquidationEngine);
        vm.serializeAddress(json, "insuranceFund", d.insuranceFund);
        vm.serializeAddress(json, "crossMargin", d.crossMargin);
        vm.serializeAddress(json, "subaccountFactory", d.subaccountFactory);
        vm.serializeAddress(json, "rfqManager", d.rfqManager);
        string memory finalJson = vm.serializeAddress(json, "settlementToken", d.settlementToken);

        string memory network = vm.envOr("NETWORK_NAME", string("localhost"));
        string memory path = string.concat("deployments/", network, ".json");
        vm.writeJson(finalJson, path);
    }

    function _logSummary(Stack memory d) internal pure {
        console.log("ZenoMarketRegistry:        ", d.marketRegistry);
        console.log("ZenoCollateralManager:     ", d.collateralManager);
        console.log("ZenoVault:          ", d.vault);
        console.log("ZenoFeeManager:            ", d.feeManager);
        console.log("ZenoBuybackModule:         ", d.buybackModule);
        console.log("ZenoPriceValidator:        ", d.priceValidator);
        console.log("ZenoOracleRouter:          ", d.oracleRouter);
        console.log("ZenoRiskManager:           ", d.riskManager);
        console.log("ZenoOptionPositionManager: ", d.optionPositionManager);
        console.log("ZenoOptionMarket:          ", d.optionMarket);
        console.log("ZenoOptionsEngine:         ", d.optionsEngine);
        console.log("ZenoPerpPositionManager:   ", d.perpPositionManager);
        console.log("ZenoPerpOrderManager:      ", d.perpOrderManager);
        console.log("ZenoFundingManager:        ", d.fundingManager);
        console.log("ZenoPerpsEngine:           ", d.perpsEngine);
        console.log("ZenoLiquidationEngine:     ", d.liquidationEngine);
        console.log("ZenoInsuranceFund:         ", d.insuranceFund);
        console.log("ZenoCrossMarginManager:    ", d.crossMargin);
        console.log("ZenoSubaccountFactory:     ", d.subaccountFactory);
        console.log("ZenoRFQManager:            ", d.rfqManager);
    }
}
