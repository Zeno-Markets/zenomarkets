// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ZenoPriceValidator} from "../src/oracle/ZenoPriceValidator.sol";

/// @notice Ships the session-aware `ZenoPriceValidator` (`DEVELOPMENT_PHASES.md` Phase 4) to a network that
/// is already deployed, and nothing else. `UpgradeAll.s.sol` would replace all 20 implementations with
/// whatever the working tree compiles to, which on mainnet means shipping every other contract's
/// uncommitted state as well; this replaces one.
///
/// Safe because the change only appends state (`tradingSession`, `sessionHoliday`):
/// `script/check-storage-layout.py` is the guard, and no initializer runs, so the existing per-market
/// `maxPriceAge` and `maxDeviationBps` survive.
///
/// The caller must hold `DEFAULT_ADMIN_ROLE` on the proxy (the deployer, until `HandOverAdmin.s.sol`).
/// Optional: NETWORK_NAME (default `robinhood_testnet`), PRIVATE_KEY.
///
/// Usage (dry run first; add --broadcast to send):
///   NETWORK_NAME=robinhood_mainnet forge script script/UpgradePriceValidator.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --account zeno-mainnet --sender <deployer>
/// Then run `script/SetLaunchCaps.s.sol`, which needs the new `setTradingSession`.
contract UpgradePriceValidator is Script {
    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_testnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        address proxy = vm.parseJsonAddress(json, ".priceValidator");

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        address implementation = address(new ZenoPriceValidator());
        UUPSUpgradeable(proxy).upgradeToAndCall(implementation, "");
        vm.stopBroadcast();

        console.log("ZenoPriceValidator proxy:         ", proxy);
        console.log("New implementation:           ", implementation);
        console.log("Record it in deployments/", string.concat(network, ".implementations.json"));
    }
}
