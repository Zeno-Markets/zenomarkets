// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ZenoMarketRegistry} from "../../src/core/ZenoMarketRegistry.sol";
import {ZenoCollateralManager} from "../../src/core/ZenoCollateralManager.sol";
import {ZenoVault} from "../../src/core/ZenoVault.sol";
import {ZenoFeeManager} from "../../src/core/ZenoFeeManager.sol";
import {ZenoBuybackModule} from "../../src/core/ZenoBuybackModule.sol";
import {ZenoPriceValidator} from "../../src/oracle/ZenoPriceValidator.sol";
import {ZenoOracleRouter} from "../../src/oracle/ZenoOracleRouter.sol";
import {ZenoTestnetFeed} from "../../src/oracle/ZenoTestnetFeed.sol";
import {ZenoRiskManager} from "../../src/risk/ZenoRiskManager.sol";
import {ZenoOptionPositionManager} from "../../src/options/ZenoOptionPositionManager.sol";
import {ZenoOptionMarket} from "../../src/options/ZenoOptionMarket.sol";
import {IOptionsEngine} from "../../src/interfaces/IOptionsEngine.sol";
import {ZenoOptionsEngine} from "../../src/options/ZenoOptionsEngine.sol";
import {ZenoPerpPositionManager} from "../../src/perps/ZenoPerpPositionManager.sol";
import {ZenoPerpOrderManager} from "../../src/perps/ZenoPerpOrderManager.sol";
import {ZenoInsuranceFund} from "../../src/core/ZenoInsuranceFund.sol";
import {ZenoRFQManager} from "../../src/perps/ZenoRFQManager.sol";
import {ZenoCrossMarginManager} from "../../src/risk/ZenoCrossMarginManager.sol";
import {ZenoFundingManager} from "../../src/perps/ZenoFundingManager.sol";
import {ZenoPerpsEngine} from "../../src/perps/ZenoPerpsEngine.sol";
import {ZenoLiquidationEngine} from "../../src/perps/ZenoLiquidationEngine.sol";
import {MarketConfig} from "../../src/interfaces/DataTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {StackDeployer} from "../../script/utils/StackDeployer.sol";

/// @notice Deploys the full Zeno Phase 1 contract stack, wires every
/// AccessControl role, seeds one market ("NVDA"), and funds two test users with deposited
/// collateral — shared setup for unit, fuzz, and integration tests.
contract BaseTest is Test, StackDeployer {
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");
    /// Signs option premium quotes, standing in for services/pricing.
    uint256 internal quoterKey = uint256(keccak256("zeno.test.quoter"));
    address internal quoter = vm.addr(quoterKey);
    uint256 internal nextQuoteNonce = 1;

    bytes32 internal constant NVDA = bytes32("NVDA");
    uint256 internal constant WAD = 1e18;

    /// Proxy addresses of the deployed stack, for tests that upgrade it.
    Stack internal stack;

    MockERC20 internal usdc;
    ZenoTestnetFeed internal priceFeed;

    ZenoMarketRegistry internal marketRegistry;
    ZenoCollateralManager internal collateralManager;
    ZenoVault internal vault;
    ZenoFeeManager internal feeManager;
    ZenoBuybackModule internal buybackModule;
    ZenoPriceValidator internal priceValidator;
    ZenoOracleRouter internal oracleRouter;
    ZenoRiskManager internal riskManager;
    ZenoOptionPositionManager internal optionPositionManager;
    ZenoOptionMarket internal optionMarket;
    ZenoOptionsEngine internal optionsEngine;
    ZenoPerpPositionManager internal perpPositionManager;
    ZenoPerpOrderManager internal perpOrderManager;
    ZenoFundingManager internal fundingManager;
    ZenoPerpsEngine internal perpsEngine;
    ZenoLiquidationEngine internal liquidationEngine;
    ZenoInsuranceFund internal insuranceFund;
    ZenoCrossMarginManager internal crossMargin;
    ZenoRFQManager internal rfqManager;

    /// @dev Decimals of the settlement token. A test overrides this to run the whole stack on a token
    /// that is not 18 decimals, like the 6-decimal USDC-style token the testnet uses.
    function _settlementDecimals() internal pure virtual returns (uint8) {
        return 18;
    }

    /// @dev Capital the vault's pool holds from the start, in whole settlement tokens. A trader's profit is
    /// paid from this pool while the loser's side is still unrealized, and a credit larger than the pool
    /// reverts with `InsufficientPoolReserves`. A test of that limit overrides this with a small number.
    function _poolSeed() internal pure virtual returns (uint256) {
        return 10_000_000;
    }

    function setUp() public virtual {
        vm.startPrank(admin);

        usdc = new MockERC20("USD Coin", "USDC", _settlementDecimals());
        priceFeed = new ZenoTestnetFeed(admin, 18, 190e18);

        (Stack memory s,) = _deployStack(admin, address(usdc));
        stack = s;
        marketRegistry = ZenoMarketRegistry(s.marketRegistry);
        collateralManager = ZenoCollateralManager(s.collateralManager);
        vault = ZenoVault(s.vault);
        feeManager = ZenoFeeManager(s.feeManager);
        buybackModule = ZenoBuybackModule(s.buybackModule);
        priceValidator = ZenoPriceValidator(s.priceValidator);
        oracleRouter = ZenoOracleRouter(s.oracleRouter);
        riskManager = ZenoRiskManager(s.riskManager);
        optionPositionManager = ZenoOptionPositionManager(s.optionPositionManager);
        optionMarket = ZenoOptionMarket(s.optionMarket);
        optionsEngine = ZenoOptionsEngine(s.optionsEngine);
        perpPositionManager = ZenoPerpPositionManager(s.perpPositionManager);
        perpOrderManager = ZenoPerpOrderManager(s.perpOrderManager);
        fundingManager = ZenoFundingManager(s.fundingManager);
        insuranceFund = ZenoInsuranceFund(s.insuranceFund);
        crossMargin = ZenoCrossMarginManager(s.crossMargin);
        perpsEngine = ZenoPerpsEngine(s.perpsEngine);
        liquidationEngine = ZenoLiquidationEngine(s.liquidationEngine);
        rfqManager = ZenoRFQManager(s.rfqManager);
        perpsEngine.setRfqManager(address(rfqManager));
        rfqManager.grantRole(rfqManager.MAKER_ROLE(), quoter);

        _wireRoles();
        _seedMarket();

        uint256 seed = _poolSeed() * 10 ** _settlementDecimals();
        if (seed > 0) {
            usdc.mint(admin, seed);
            usdc.approve(address(vault), seed);
            vault.fundPool(address(usdc), seed);
        }

        vm.stopPrank();

        _fundUser(alice);
        _fundUser(bob);
    }

    /// @dev A proxy on `impl`, initialized with `owner`, for tests that need a contract of their own
    /// next to the shared stack.
    function _proxyFor(address impl, address owner) internal returns (address) {
        return address(new ERC1967Proxy(impl, abi.encodeWithSignature("initialize(address)", owner)));
    }

    function _wireRoles() internal {
        collateralManager.grantRole(collateralManager.VAULT_ROLE(), address(vault));

        bytes32 vaultEngineRole = vault.ENGINE_ROLE();
        vault.grantRole(vaultEngineRole, address(optionsEngine));
        vault.grantRole(vaultEngineRole, address(perpsEngine));
        vault.grantRole(vaultEngineRole, address(liquidationEngine));
        vault.grantRole(vaultEngineRole, address(fundingManager));
        vault.grantRole(vaultEngineRole, address(crossMargin));
        vault.grantRole(vault.FEE_MANAGER_ROLE(), address(feeManager));
        vault.setWithdrawGuard(address(crossMargin));
        crossMargin.grantRole(crossMargin.ENGINE_ROLE(), address(perpsEngine));
        crossMargin.grantRole(crossMargin.LIQUIDATOR_ROLE(), address(liquidationEngine));

        bytes32 feeEngineRole = feeManager.ENGINE_ROLE();
        feeManager.grantRole(feeEngineRole, address(optionsEngine));
        feeManager.grantRole(feeEngineRole, address(perpsEngine));
        feeManager.grantRole(feeEngineRole, address(liquidationEngine));

        bytes32 riskEngineRole = riskManager.ENGINE_ROLE();
        riskManager.grantRole(riskEngineRole, address(optionsEngine));
        riskManager.grantRole(riskEngineRole, address(perpsEngine));
        riskManager.grantRole(riskEngineRole, address(liquidationEngine));

        optionsEngine.grantRole(optionsEngine.QUOTER_ROLE(), quoter);
        optionPositionManager.grantRole(optionPositionManager.ENGINE_ROLE(), address(optionsEngine));
        optionMarket.grantRole(optionMarket.ENGINE_ROLE(), address(optionsEngine));

        bytes32 perpEngineRole = perpPositionManager.ENGINE_ROLE();
        perpPositionManager.grantRole(perpEngineRole, address(perpsEngine));
        perpPositionManager.grantRole(perpEngineRole, address(fundingManager));
        perpPositionManager.grantRole(perpEngineRole, address(liquidationEngine));
        perpOrderManager.grantRole(perpOrderManager.ENGINE_ROLE(), address(perpsEngine));

        bytes32 fundingEngineRole = fundingManager.ENGINE_ROLE();
        fundingManager.grantRole(fundingEngineRole, address(perpsEngine));
        fundingManager.grantRole(fundingEngineRole, address(liquidationEngine));

        bytes32 oracleEngineRole = oracleRouter.ENGINE_ROLE();
        oracleRouter.grantRole(oracleEngineRole, address(perpsEngine));
        oracleRouter.grantRole(oracleEngineRole, address(liquidationEngine));

        buybackModule.grantRole(buybackModule.FEE_MANAGER_ROLE(), address(feeManager));

        collateralManager.addSupportedToken(address(usdc));
        oracleRouter.setPrimarySource(NVDA, address(priceFeed), 18);
    }

    function _seedMarket() internal {
        marketRegistry.addMarket(
            MarketConfig({
                marketId: NVDA,
                underlyingToken: address(0xBEEF),
                oracleId: NVDA,
                optionsEnabled: true,
                perpsEnabled: true,
                maxLeverage: 10,
                openInterestCap: 5_000_000e18,
                active: true
            })
        );

        uint256[] memory tiers = new uint256[](5);
        tiers[0] = 1;
        tiers[1] = 2;
        tiers[2] = 3;
        tiers[3] = 5;
        tiers[4] = 10;

        riskManager.setRiskConfig(
            NVDA,
            ZenoRiskManager.RiskConfig({
                maxLeverage: 10,
                allowedLeverageTiers: tiers,
                initialMarginRateBps: 1000,
                maintenanceMarginRateBps: 500,
                maxPositionNotional: 500_000e18,
                openInterestCap: 5_000_000e18
            })
        );
    }

    function _fundUser(address user) internal {
        usdc.mint(user, 1_000_000e18);
        vm.startPrank(user);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), 100_000e18);
        vm.stopPrank();
    }

    function _setPrice(uint256 price) internal {
        vm.prank(admin);
        priceFeed.setPrice(price);
    }

    // ---------------------------------------------------------------------
    // Signed option quotes
    // ---------------------------------------------------------------------

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _openQuote(address user, IOptionsEngine.OpenPositionParams memory params)
        internal
        returns (IOptionsEngine.Quote memory)
    {
        return _openQuoteSignedBy(quoterKey, user, params, block.timestamp + 60);
    }

    function _openQuoteSignedBy(
        uint256 key,
        address user,
        IOptionsEngine.OpenPositionParams memory params,
        uint256 validUntil
    ) internal returns (IOptionsEngine.Quote memory) {
        uint256 nonce = nextQuoteNonce++;
        bytes32 digest = optionsEngine.openQuoteDigest(user, params, validUntil, nonce);
        return IOptionsEngine.Quote({validUntil: validUntil, nonce: nonce, signature: _sign(key, digest)});
    }

    function _closeQuote(address user, uint256 positionId, uint256 premium)
        internal
        returns (IOptionsEngine.Quote memory)
    {
        uint256 validUntil = block.timestamp + 60;
        uint256 nonce = nextQuoteNonce++;
        bytes32 digest = optionsEngine.closeQuoteDigest(user, positionId, premium, validUntil, nonce);
        return IOptionsEngine.Quote({validUntil: validUntil, nonce: nonce, signature: _sign(quoterKey, digest)});
    }
}
