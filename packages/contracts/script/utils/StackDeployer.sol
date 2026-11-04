// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {ZenoUpgradePlaceholder} from "../../src/proxy/ZenoUpgradePlaceholder.sol";
import {ZenoMarketRegistry} from "../../src/core/ZenoMarketRegistry.sol";
import {ZenoCollateralManager} from "../../src/core/ZenoCollateralManager.sol";
import {ZenoVault} from "../../src/core/ZenoVault.sol";
import {ZenoFeeManager} from "../../src/core/ZenoFeeManager.sol";
import {ZenoBuybackModule} from "../../src/core/ZenoBuybackModule.sol";
import {ZenoPriceValidator} from "../../src/oracle/ZenoPriceValidator.sol";
import {ZenoOracleRouter} from "../../src/oracle/ZenoOracleRouter.sol";
import {ZenoRiskManager} from "../../src/risk/ZenoRiskManager.sol";
import {ZenoOptionPositionManager} from "../../src/options/ZenoOptionPositionManager.sol";
import {ZenoOptionMarket} from "../../src/options/ZenoOptionMarket.sol";
import {ZenoOptionsEngine} from "../../src/options/ZenoOptionsEngine.sol";
import {ZenoPerpPositionManager} from "../../src/perps/ZenoPerpPositionManager.sol";
import {ZenoPerpOrderManager} from "../../src/perps/ZenoPerpOrderManager.sol";
import {ZenoInsuranceFund} from "../../src/core/ZenoInsuranceFund.sol";
import {ZenoCrossMarginManager} from "../../src/risk/ZenoCrossMarginManager.sol";
import {ZenoSubaccountFactory} from "../../src/accounts/ZenoSubaccountFactory.sol";
import {ZenoRFQManager} from "../../src/perps/ZenoRFQManager.sol";
import {ZenoFundingManager} from "../../src/perps/ZenoFundingManager.sol";
import {ZenoPerpsEngine} from "../../src/perps/ZenoPerpsEngine.sol";
import {ZenoLiquidationEngine} from "../../src/perps/ZenoLiquidationEngine.sol";

/// @notice Builds the protocol stack behind ERC-1967 proxies. `DeployAll`, `UpgradeAll` and the test
/// base contract share it, so the tests run against exactly what the deploy script builds.
///
/// Every contract reads the other contracts' addresses as immutables, so the proxies (whose addresses
/// never change) come first, then the implementations that point at them.
///
/// Everything here runs as the caller: under `vm.startBroadcast` or `vm.startPrank` the caller is the
/// admin, which is also the only address allowed to upgrade a proxy.
abstract contract StackDeployer {
    /// @dev Proxy addresses. These are the addresses every client uses, and they never change.
    struct Stack {
        address marketRegistry;
        address collateralManager;
        address vault;
        address feeManager;
        address buybackModule;
        address priceValidator;
        address oracleRouter;
        address riskManager;
        address optionPositionManager;
        address optionMarket;
        address optionsEngine;
        address perpPositionManager;
        address perpOrderManager;
        address fundingManager;
        address perpsEngine;
        address liquidationEngine;
        address insuranceFund;
        address crossMargin;
        address subaccountFactory;
        address rfqManager;
        address settlementToken;
    }

    /// @dev Implementation addresses, same fields as `Stack` (`settlementToken` stays zero).
    struct Impls {
        address marketRegistry;
        address collateralManager;
        address vault;
        address feeManager;
        address buybackModule;
        address priceValidator;
        address oracleRouter;
        address riskManager;
        address optionPositionManager;
        address optionMarket;
        address optionsEngine;
        address perpPositionManager;
        address perpOrderManager;
        address fundingManager;
        address perpsEngine;
        address liquidationEngine;
        address insuranceFund;
        address crossMargin;
        address subaccountFactory;
        address rfqManager;
    }

    /// @dev First deployment: one proxy per contract, all on the placeholder, then the real
    /// implementations, then each proxy is upgraded and initialized in one call.
    function _deployStack(address admin, address settlementToken) internal returns (Stack memory s, Impls memory i) {
        s = _newProxies(admin);
        s.settlementToken = settlementToken;
        i = _deployImpls(s);
        _initialize(s, i, admin);
    }

    function _newProxies(address admin) internal returns (Stack memory s) {
        address placeholder = address(new ZenoUpgradePlaceholder());
        bytes memory setOwner = abi.encodeCall(ZenoUpgradePlaceholder.setOwner, (admin));
        s.marketRegistry = address(new ERC1967Proxy(placeholder, setOwner));
        s.collateralManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.vault = address(new ERC1967Proxy(placeholder, setOwner));
        s.feeManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.buybackModule = address(new ERC1967Proxy(placeholder, setOwner));
        s.priceValidator = address(new ERC1967Proxy(placeholder, setOwner));
        s.oracleRouter = address(new ERC1967Proxy(placeholder, setOwner));
        s.riskManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.optionPositionManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.optionMarket = address(new ERC1967Proxy(placeholder, setOwner));
        s.optionsEngine = address(new ERC1967Proxy(placeholder, setOwner));
        s.perpPositionManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.perpOrderManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.fundingManager = address(new ERC1967Proxy(placeholder, setOwner));
        s.perpsEngine = address(new ERC1967Proxy(placeholder, setOwner));
        s.liquidationEngine = address(new ERC1967Proxy(placeholder, setOwner));
        s.insuranceFund = address(new ERC1967Proxy(placeholder, setOwner));
        s.crossMargin = address(new ERC1967Proxy(placeholder, setOwner));
        s.subaccountFactory = address(new ERC1967Proxy(placeholder, setOwner));
        s.rfqManager = address(new ERC1967Proxy(placeholder, setOwner));
    }

    /// @dev Deploys a fresh implementation of every contract, wired to the proxies in `s`.
    function _deployImpls(Stack memory s) internal returns (Impls memory i) {
        i.marketRegistry = address(new ZenoMarketRegistry());
        i.collateralManager = address(new ZenoCollateralManager());
        i.vault = address(new ZenoVault(s.collateralManager));
        i.feeManager = address(new ZenoFeeManager(s.vault));
        i.buybackModule = address(new ZenoBuybackModule());
        i.priceValidator = address(new ZenoPriceValidator());
        i.oracleRouter = address(new ZenoOracleRouter(s.priceValidator));
        i.riskManager = address(new ZenoRiskManager());
        i.optionPositionManager = address(new ZenoOptionPositionManager());
        i.optionMarket = address(new ZenoOptionMarket());
        i.perpPositionManager = address(new ZenoPerpPositionManager());
        i.perpOrderManager = address(new ZenoPerpOrderManager());
        i.fundingManager =
            address(new ZenoFundingManager(s.oracleRouter, s.perpPositionManager, s.vault, s.settlementToken));
        i.optionsEngine = address(
            new ZenoOptionsEngine(
                s.marketRegistry,
                s.oracleRouter,
                s.vault,
                s.feeManager,
                s.riskManager,
                s.optionPositionManager,
                s.optionMarket,
                s.settlementToken
            )
        );
        i.insuranceFund = address(new ZenoInsuranceFund(s.vault, s.settlementToken));
        i.crossMargin = address(
            new ZenoCrossMarginManager(
                s.oracleRouter,
                s.riskManager,
                s.vault,
                s.perpPositionManager,
                s.optionPositionManager,
                s.optionMarket,
                s.settlementToken,
                s.insuranceFund
            )
        );
        i.subaccountFactory = address(new ZenoSubaccountFactory(s.vault));
        i.perpsEngine = address(
            new ZenoPerpsEngine(
                s.marketRegistry,
                s.oracleRouter,
                s.vault,
                s.feeManager,
                s.riskManager,
                s.perpPositionManager,
                s.perpOrderManager,
                s.fundingManager,
                s.settlementToken,
                s.crossMargin
            )
        );
        i.liquidationEngine = address(
            new ZenoLiquidationEngine(
                s.oracleRouter,
                s.vault,
                s.feeManager,
                s.riskManager,
                s.perpPositionManager,
                s.fundingManager,
                s.settlementToken,
                s.crossMargin,
                s.insuranceFund
            )
        );
        i.rfqManager = address(new ZenoRFQManager(s.perpsEngine, s.oracleRouter));
    }

    /// @dev Points each placeholder proxy at its implementation and runs `initialize(admin)`.
    function _initialize(Stack memory s, Impls memory i, address admin) internal {
        bytes memory init = abi.encodeWithSignature("initialize(address)", admin);
        _upgrade(s.marketRegistry, i.marketRegistry, init);
        _upgrade(s.collateralManager, i.collateralManager, init);
        _upgrade(s.vault, i.vault, init);
        _upgrade(s.feeManager, i.feeManager, init);
        _upgrade(s.buybackModule, i.buybackModule, init);
        _upgrade(s.priceValidator, i.priceValidator, init);
        _upgrade(s.oracleRouter, i.oracleRouter, init);
        _upgrade(s.riskManager, i.riskManager, init);
        _upgrade(s.optionPositionManager, i.optionPositionManager, init);
        _upgrade(s.optionMarket, i.optionMarket, init);
        _upgrade(s.optionsEngine, i.optionsEngine, init);
        _upgrade(s.perpPositionManager, i.perpPositionManager, init);
        _upgrade(s.perpOrderManager, i.perpOrderManager, init);
        _upgrade(s.fundingManager, i.fundingManager, init);
        _upgrade(s.perpsEngine, i.perpsEngine, init);
        _upgrade(s.liquidationEngine, i.liquidationEngine, init);
        _upgrade(s.insuranceFund, i.insuranceFund, init);
        _upgrade(s.crossMargin, i.crossMargin, init);
        _upgrade(s.subaccountFactory, i.subaccountFactory, init);
        _upgrade(s.rfqManager, i.rfqManager, init);
    }

    /// @dev Points every proxy at a new implementation; no initializer runs, the state stays as it is.
    function _upgradeAll(Stack memory s, Impls memory i) internal {
        _upgrade(s.marketRegistry, i.marketRegistry, "");
        _upgrade(s.collateralManager, i.collateralManager, "");
        _upgrade(s.vault, i.vault, "");
        _upgrade(s.feeManager, i.feeManager, "");
        _upgrade(s.buybackModule, i.buybackModule, "");
        _upgrade(s.priceValidator, i.priceValidator, "");
        _upgrade(s.oracleRouter, i.oracleRouter, "");
        _upgrade(s.riskManager, i.riskManager, "");
        _upgrade(s.optionPositionManager, i.optionPositionManager, "");
        _upgrade(s.optionMarket, i.optionMarket, "");
        _upgrade(s.optionsEngine, i.optionsEngine, "");
        _upgrade(s.perpPositionManager, i.perpPositionManager, "");
        _upgrade(s.perpOrderManager, i.perpOrderManager, "");
        _upgrade(s.fundingManager, i.fundingManager, "");
        _upgrade(s.perpsEngine, i.perpsEngine, "");
        _upgrade(s.liquidationEngine, i.liquidationEngine, "");
        _upgrade(s.insuranceFund, i.insuranceFund, "");
        _upgrade(s.crossMargin, i.crossMargin, "");
        _upgrade(s.subaccountFactory, i.subaccountFactory, "");
        _upgrade(s.rfqManager, i.rfqManager, "");
    }

    function _upgrade(address proxy, address implementation, bytes memory data) internal {
        UUPSUpgradeable(proxy).upgradeToAndCall(implementation, data);
    }
}
