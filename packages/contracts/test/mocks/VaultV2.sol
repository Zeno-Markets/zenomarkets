// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ZenoVault} from "../../src/core/ZenoVault.sol";

/// @dev A later version of the vault, with one new function and one new state variable appended.
contract VaultV2 is ZenoVault {
    uint256 public v2Counter;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address collateralManager_) ZenoVault(collateralManager_) {}

    function version() external pure returns (uint256) {
        return 2;
    }

    function bump() external {
        v2Counter++;
    }
}
