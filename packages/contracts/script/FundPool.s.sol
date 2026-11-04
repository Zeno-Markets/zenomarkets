// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ZenoVault} from "../src/core/ZenoVault.sol";

/// @notice Adds capital to the vault's pool: the tokens it holds beyond what it owes users, which pay
/// a trader's profit while the losing side is still unrealized. The vault refuses a profit credit
/// larger than the pool (`InsufficientPoolReserves`), so a launch needs it funded first. The tokens are
/// credited to no account, and there is deliberately no way to take them back out except as payouts.
///
/// Required: AMOUNT (whole settlement tokens) or AMOUNT_RAW (base units, for a reserve below one whole
/// token - the launch pool is a fraction of one USDG). Optional: NETWORK_NAME (default
/// `robinhood_testnet`), PRIVATE_KEY (the funder; it must hold the tokens).
///
/// Usage:
///   AMOUNT=100000 forge script script/FundPool.s.sol --rpc-url $RPC_URL --broadcast
///   AMOUNT_RAW=150000 forge script script/FundPool.s.sol --rpc-url $RPC_URL --broadcast
///
/// After an upgrade of a vault that already held user balances, run
/// `vault.bootstrapLiabilities(token)` first (see `docs/RUNBOOK.md`).
contract FundPool is Script {
    function run() external {
        string memory json =
            vm.readFile(string.concat("deployments/", vm.envOr("NETWORK_NAME", string("robinhood_testnet")), ".json"));
        ZenoVault vault = ZenoVault(vm.parseJsonAddress(json, ".vault"));
        IERC20Metadata token = IERC20Metadata(vm.parseJsonAddress(json, ".settlementToken"));
        uint256 raw = vm.envOr("AMOUNT_RAW", uint256(0));
        uint256 amount = raw > 0 ? raw : vm.envUint("AMOUNT") * 10 ** token.decimals();
        require(amount > 0, "set AMOUNT or AMOUNT_RAW");

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        token.approve(address(vault), amount);
        vault.fundPool(address(token), amount);
        vm.stopBroadcast();

        console.log("Pool balance now:", vault.poolBalance(address(token)));
    }
}
