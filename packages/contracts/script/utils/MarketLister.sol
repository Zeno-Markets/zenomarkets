// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ZenoMarketRegistry} from "../../src/core/ZenoMarketRegistry.sol";
import {ZenoRiskManager} from "../../src/risk/ZenoRiskManager.sol";
import {ZenoFeeManager} from "../../src/core/ZenoFeeManager.sol";
import {ZenoOracleRouter} from "../../src/oracle/ZenoOracleRouter.sol";
import {ZenoPriceValidator} from "../../src/oracle/ZenoPriceValidator.sol";
import {ZenoChainlinkPriceFeed} from "../../src/oracle/ZenoChainlinkPriceFeed.sol";
import {MarketConfig, FeeConfig} from "../../src/interfaces/DataTypes.sol";

/// @notice Lists one market on a deployed stack against a real underlying token and a real Chainlink
/// feed. Shared by `AddMarketsMainnet.s.sol` and the mainnet fork test, so the test runs the same code
/// the launch runs. The caller must hold the market, oracle, risk and fee admin roles.
abstract contract MarketLister {
    struct Stack {
        ZenoMarketRegistry marketRegistry;
        ZenoRiskManager riskManager;
        ZenoFeeManager feeManager;
        ZenoOracleRouter oracleRouter;
        ZenoPriceValidator priceValidator;
    }

    struct Listing {
        bytes32 marketId;
        address underlyingToken;
        address chainlinkFeed;
        uint256 maxLeverage;
        uint256 maintenanceBps;
        uint256 maxPosition; // settlement token units
        uint256 openInterestCap; // settlement token units
        uint256 maxPriceAge; // seconds
    }

    function _list(Stack memory stack, Listing memory l) internal returns (address adapter) {
        require(l.maxLeverage >= 1 && l.maxLeverage <= 10, "leverage must be 1 to 10");
        uint256 initialBps = 10_000 / l.maxLeverage;
        require(l.maintenanceBps < initialBps, "maintenance margin must be below initial margin");
        require(l.maxPriceAge > 0, "price age limit must be set");

        ZenoChainlinkPriceFeed feed = new ZenoChainlinkPriceFeed(l.chainlinkFeed);
        adapter = address(feed);
        stack.oracleRouter.setPrimarySource(l.marketId, adapter, feed.decimals());
        stack.priceValidator.setMaxPriceAge(l.marketId, l.maxPriceAge);

        stack.marketRegistry
            .addMarket(
                MarketConfig({
                    marketId: l.marketId,
                    underlyingToken: l.underlyingToken,
                    oracleId: l.marketId,
                    optionsEnabled: true,
                    perpsEnabled: true,
                    maxLeverage: l.maxLeverage,
                    openInterestCap: l.openInterestCap,
                    active: true
                })
            );

        uint256[5] memory allTiers = [uint256(1), 2, 3, 5, 10];
        uint256 count;
        for (uint256 i; i < allTiers.length; i++) {
            if (allTiers[i] <= l.maxLeverage) count++;
        }
        uint256[] memory tiers = new uint256[](count);
        for (uint256 i; i < count; i++) {
            tiers[i] = allTiers[i];
        }
        stack.riskManager
            .setRiskConfig(
                l.marketId,
                ZenoRiskManager.RiskConfig({
                    maxLeverage: l.maxLeverage,
                    allowedLeverageTiers: tiers,
                    initialMarginRateBps: initialBps,
                    maintenanceMarginRateBps: l.maintenanceBps,
                    maxPositionNotional: l.maxPosition,
                    openInterestCap: l.openInterestCap
                })
            );

        // Placeholder fees, the same as the testnet markets: the product owner still has to set them.
        stack.feeManager
            .setFeeConfig(
                l.marketId,
                FeeConfig({
                    makerFee: 5,
                    takerFee: 10,
                    optionOpenFee: 20,
                    optionCloseFee: 20,
                    settlementFee: 10,
                    liquidationFee: 100
                })
            );
    }
}
