// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWeth9 {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IV3Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @dev One atomic call: ETH to USDG, USDG to an exact amount of TSLA for `to`, the seed into the pair, the change
/// back to `to`. A failed check undoes all of it. WETH and TSLA are token0 of their pools, USDG is token1 of both.
contract CreditSeeder {
    uint160 private constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;
    uint160 private constant MAX_SQRT_RATIO_MINUS_ONE = 1461446703485210103287273052203988822378723970341;

    address private immutable owner = msg.sender;
    IV3Pool private immutable wethPool;
    IV3Pool private immutable tslaPool;
    IWeth9 private immutable weth;
    IERC20 private immutable usdg;

    constructor(IV3Pool wethPool_, IV3Pool tslaPool_, IWeth9 weth_, IERC20 usdg_) {
        (wethPool, tslaPool, weth, usdg) = (wethPool_, tslaPool_, weth_, usdg_);
    }

    function seed(address pair, uint256 seedAmount, uint256 tslaOut, uint256 maxUsdgForTsla, address to) external payable {
        require(msg.sender == owner, "not the owner");
        weth.deposit{value: msg.value}();
        wethPool.swap(address(this), true, int256(msg.value), MIN_SQRT_RATIO_PLUS_ONE, "");
        if (tslaOut > 0) {
            (int256 tslaDelta, int256 paid) = tslaPool.swap(to, false, -int256(tslaOut), MAX_SQRT_RATIO_MINUS_ONE, "");
            require(uint256(-tslaDelta) == tslaOut, "short TSLA fill");
            require(uint256(paid) <= maxUsdgForTsla, "TSLA too dear");
        }
        require(usdg.transfer(pair, seedAmount), "seed failed");
        require(usdg.transfer(to, usdg.balanceOf(address(this))), "change failed");
    }

    function uniswapV3SwapCallback(int256 amount0, int256 amount1, bytes calldata) external {
        if (msg.sender == address(wethPool)) require(weth.transfer(msg.sender, uint256(amount0)), "pay WETH");
        else if (msg.sender == address(tslaPool)) require(usdg.transfer(msg.sender, uint256(amount1)), "pay USDG");
        else revert("not a pool");
    }
}

/// @notice Seeds the TSLA/USDG lending pair from the deployer's ETH, and buys the TSLA a test position needs.
/// Driven by scripts/mainnet-seed-credit.sh, which sizes the amounts.
contract SeedCreditPair is Script {
    function run() external {
        address sender = msg.sender;
        vm.startBroadcast();
        CreditSeeder seeder = new CreditSeeder(
            IV3Pool(vm.envAddress("WETH_POOL")),
            IV3Pool(vm.envAddress("TSLA_POOL")),
            IWeth9(vm.envAddress("WETH")),
            IERC20(vm.envAddress("USDG"))
        );
        seeder.seed{value: vm.envUint("SWAP_ETH_WEI")}(
            vm.envAddress("PAIR"), vm.envUint("SEED_RAW"), vm.envUint("TSLA_OUT"), vm.envUint("MAX_USDG_FOR_TSLA"), sender
        );
        vm.stopBroadcast();
        console.log("Pair USDG (base units):", IERC20(vm.envAddress("USDG")).balanceOf(vm.envAddress("PAIR")));
    }
}
