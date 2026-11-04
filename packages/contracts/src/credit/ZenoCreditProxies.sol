// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ZenoCreditRegistry} from "./ZenoCreditRegistry.sol";
import {ZenoCreditPair} from "./ZenoCreditPair.sol";
import {ZenoCreditRouter} from "./ZenoCreditRouter.sol";
import {ZenoCreditVault} from "./ZenoCreditVault.sol";
import {ZenoFeedOracle} from "../oracle/ZenoFeedOracle.sol";

/// @title ZenoCreditProxies
/// @notice Deploys each Zeno contract as an implementation plus an ERC1967 UUPS proxy that is
/// initialized in the same transaction, so no proxy is ever left uninitialized.
/// @dev The `*At` variants take an existing implementation, letting several proxies share one.
library ZenoCreditProxies {
    function _proxy(address implementation, bytes memory init) private returns (address) {
        return address(new ERC1967Proxy(implementation, init));
    }

    function registry(address owner) internal returns (ZenoCreditRegistry) {
        return ZenoCreditRegistry(
            _proxy(address(new ZenoCreditRegistry()), abi.encodeCall(ZenoCreditRegistry.initialize, (owner)))
        );
    }

    function lendingRouter(address owner) internal returns (ZenoCreditRouter) {
        return
            ZenoCreditRouter(
                _proxy(address(new ZenoCreditRouter()), abi.encodeCall(ZenoCreditRouter.initialize, (owner)))
            );
    }

    function vault(
        IERC20 asset,
        string memory name,
        string memory symbol,
        string memory slug,
        string memory riskTier,
        address owner
    ) internal returns (ZenoCreditVault) {
        return ZenoCreditVault(
            _proxy(
                address(new ZenoCreditVault()),
                abi.encodeCall(ZenoCreditVault.initialize, (asset, name, symbol, slug, riskTier, owner))
            )
        );
    }

    function oracle(
        address owner,
        uint256 expectedChainId,
        address sequencer,
        uint256 gracePeriod,
        ZenoFeedOracle.FeedInput[] memory inputs
    ) internal returns (ZenoFeedOracle) {
        return oracleAt(address(new ZenoFeedOracle()), owner, expectedChainId, sequencer, gracePeriod, inputs);
    }

    function oracleAt(
        address implementation,
        address owner,
        uint256 expectedChainId,
        address sequencer,
        uint256 gracePeriod,
        ZenoFeedOracle.FeedInput[] memory inputs
    ) internal returns (ZenoFeedOracle) {
        return ZenoFeedOracle(
            _proxy(
                implementation,
                abi.encodeCall(ZenoFeedOracle.initialize, (owner, expectedChainId, sequencer, gracePeriod, inputs))
            )
        );
    }

    function pair(
        bytes32 marketId,
        address collateral,
        address debt,
        address priceOracle,
        address marketRegistry,
        address owner
    ) internal returns (ZenoCreditPair) {
        return pairAt(address(new ZenoCreditPair()), marketId, collateral, debt, priceOracle, marketRegistry, owner);
    }

    function pairAt(
        address implementation,
        bytes32 marketId,
        address collateral,
        address debt,
        address priceOracle,
        address marketRegistry,
        address owner
    ) internal returns (ZenoCreditPair) {
        return ZenoCreditPair(
            _proxy(
                implementation,
                abi.encodeCall(
                    ZenoCreditPair.initialize, (marketId, collateral, debt, priceOracle, marketRegistry, owner)
                )
            )
        );
    }
}
