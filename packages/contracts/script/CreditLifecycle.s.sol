// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {ZenoCompositeSanityOracle} from "../src/oracle/ZenoCompositeSanityOracle.sol";
import {ZenoCreditRegistry} from "../src/credit/ZenoCreditRegistry.sol";
import {ZenoCreditPair} from "../src/credit/ZenoCreditPair.sol";

/// @notice Lifecycle test for the credit stack. Runs deposit, borrow, accrue, repay, withdraw on
/// mainnet against a deployed and unpaused TSLA/USDG pair. The operator runs this after USDG is
/// funded and the pair is unpaused.
///
/// **Do NOT run this while the pair is paused or USDG is unfunded.** It will revert.
///
/// Prerequisites:
///   - `DeployCreditStack.s.sol` has been broadcast and credit addresses are in the deployment file
///   - The pair's oracle has prices set for both TSLA and USDG
///   - The pair is unpaused (MarketStatus.NORMAL)
///   - The owner wallet holds enough TSLA for a deposit and enough USDG for repayment
///   - The pair holds enough USDG liquidity for a borrow
///
/// Usage:
///   forge script script/CreditLifecycle.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --account zeno-mainnet --sender <deployer> --broadcast --slow
contract CreditLifecycle is Script {
    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_mainnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));

        address pairAddr = vm.parseJsonAddress(json, ".creditPairTslaUsdg");
        require(pairAddr != address(0), "creditPairTslaUsdg not found in deployment file");

        ZenoCreditPair pair = ZenoCreditPair(pairAddr);
        IERC20 collateral = pair.collateralToken();
        IERC20 debt = pair.debtToken();

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address user = deployerKey == 0 ? msg.sender : vm.addr(deployerKey);

        uint8 collateralDecimals = IERC20Metadata(address(collateral)).decimals();
        uint8 debtDecimals = IERC20Metadata(address(debt)).decimals();

        // Use small amounts for the lifecycle test
        uint256 depositAmount = 10 ** uint256(collateralDecimals) / 10000; // 0.0001 collateral tokens
        uint256 borrowAmount = 10 ** uint256(debtDecimals) / 10000; // 0.0001 debt tokens

        console.log("=== Credit Lifecycle Test ===");
        console.log("Pair:               ", pairAddr);
        console.log("Collateral token:   ", address(collateral));
        console.log("Debt token:         ", address(debt));
        console.log("User:               ", user);
        console.log("Deposit amount:     ", depositAmount);
        console.log("Borrow amount:      ", borrowAmount);

        if (deployerKey == 0) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        // Step 1: Deposit collateral
        console.log("--- Step 1: Deposit collateral ---");
        collateral.approve(pairAddr, depositAmount);
        pair.depositCollateral(depositAmount);
        _logPosition(pair, user, "after deposit");

        // Step 2: Borrow debt tokens
        console.log("--- Step 2: Borrow ---");
        pair.borrow(borrowAmount);
        _logPosition(pair, user, "after borrow");

        // Step 3: Accrue — in a real scenario, time passes and interest accrues.
        // The current pair has no interest model, so this is a read-only check.
        console.log("--- Step 3: Accrue (read position) ---");
        _logPosition(pair, user, "accrue check");

        // Step 4: Repay all debt
        console.log("--- Step 4: Repay ---");
        (, uint256 currentDebt,,) = pair.getPosition(user);
        debt.approve(pairAddr, currentDebt);
        pair.repay(currentDebt);
        _logPosition(pair, user, "after repay");

        // Step 5: Withdraw all collateral
        console.log("--- Step 5: Withdraw ---");
        (uint256 currentCollateral,,,) = pair.getPosition(user);
        pair.withdrawCollateral(currentCollateral);
        _logPosition(pair, user, "after withdraw");

        vm.stopBroadcast();

        console.log("=== Lifecycle complete ===");
    }

    function _logPosition(ZenoCreditPair pair, address user, string memory label) internal view {
        (uint256 col, uint256 dbt, uint256 colVal, uint256 hf) = pair.getPosition(user);
        console.log(label);
        console.log("  collateral:       ", col);
        console.log("  debt:             ", dbt);
        console.log("  collateralValUsd: ", colVal);
        console.log("  healthFactorBps:  ", hf);
    }
}
