// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ZenoMarketRegistry} from "../src/core/ZenoMarketRegistry.sol";
import {ZenoRiskManager} from "../src/risk/ZenoRiskManager.sol";

/// @notice Sets the most that long and short open interest may differ by, for one market or all of them.
/// The vault is the counterparty to that difference, so it bounds what a one-sided price move can cost
/// the pool. `script/check-launch-limits.sh` checks the result against the pool.
///
/// Required: VALUE (whole settlement tokens) or VALUE_RAW (base units, for a limit below one whole
/// token). Optional: SYMBOL (one market; every market when unset), NETWORK_NAME (default
/// `robinhood_testnet`), PRIVATE_KEY (needs `RISK_ADMIN_ROLE`).
///
/// `script/SetLaunchCaps.s.sol` sets this limit together with the position and open-interest caps from
/// `deployments/<network>.limits.json`; this script stays for changing one market's limit by hand.
///
/// Usage:
///   VALUE=50000 forge script script/SetNetOpenInterest.s.sol --rpc-url $RPC_URL --broadcast
///   VALUE_RAW=8000 SYMBOL=NVDA forge script script/SetNetOpenInterest.s.sol --rpc-url $RPC_URL --broadcast
contract SetNetOpenInterest is Script {
    function run() external {
        string memory json =
            vm.readFile(string.concat("deployments/", vm.envOr("NETWORK_NAME", string("robinhood_testnet")), ".json"));
        ZenoMarketRegistry registry = ZenoMarketRegistry(vm.parseJsonAddress(json, ".marketRegistry"));
        ZenoRiskManager risk = ZenoRiskManager(vm.parseJsonAddress(json, ".riskManager"));
        uint256 raw = vm.envOr("VALUE_RAW", uint256(0));
        uint256 value = raw > 0
            ? raw
            : vm.envUint("VALUE") * 10 ** IERC20Metadata(vm.parseJsonAddress(json, ".settlementToken")).decimals();
        require(value > 0, "set VALUE or VALUE_RAW");
        string memory symbol = vm.envOr("SYMBOL", string(""));

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        if (bytes(symbol).length > 0) {
            risk.setMaxNetOpenInterest(bytes32(bytes(symbol)), value);
        } else {
            bytes32[] memory ids = registry.allMarketIds();
            for (uint256 i; i < ids.length; i++) {
                risk.setMaxNetOpenInterest(ids[i], value);
            }
            console.log("Set for markets:", ids.length);
        }
        vm.stopBroadcast();
    }
}
