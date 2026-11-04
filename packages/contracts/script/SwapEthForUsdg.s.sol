// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

interface IWeth {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

/// @notice Swaps ETH for the settlement token (USDG) on the Uniswap v3 WETH / USDG pool. An EOA cannot receive the
/// pool's callback, so this deploys a small helper, sends it the ETH, and the helper wraps it and swaps. The helper
/// keeps nothing: the USDG goes straight to `RECIPIENT` and `MIN_OUT` stops a bad fill.
///
/// Required: SWAP_ETH_WEI, MIN_OUT (USDG base units), POOL (the v3 pool; WETH must be its token0), WETH.
/// Optional: RECIPIENT (default the signer).
///
///   SWAP_ETH_WEI=1000000000000000 MIN_OUT=2000000 POOL=0x52e6... WETH=0x0Bd7... \
///   forge script script/SwapEthForUsdg.s.sol --rpc-url $RPC_URL --private-key $KEY [--broadcast]
contract EthToUsdgSwap {
    uint160 internal constant MIN_SQRT_RATIO_PLUS_ONE = 4295128740;

    IUniswapV3Pool public immutable pool;
    IWeth public immutable weth;

    constructor(address pool_, address weth_) {
        pool = IUniswapV3Pool(pool_);
        weth = IWeth(weth_);
    }

    function swap(address recipient, uint256 minOut) external payable returns (uint256 out) {
        weth.deposit{value: msg.value}();
        (, int256 amount1) = pool.swap(recipient, true, int256(msg.value), MIN_SQRT_RATIO_PLUS_ONE, "");
        out = uint256(-amount1);
        require(out >= minOut, "too little USDG");
    }

    function uniswapV3SwapCallback(int256 amount0, int256, bytes calldata) external {
        require(msg.sender == address(pool), "not the pool");
        if (amount0 > 0) weth.transfer(msg.sender, uint256(amount0));
    }
}

contract SwapEthForUsdg is Script {
    function run() external {
        uint256 amount = vm.envUint("SWAP_ETH_WEI");
        uint256 minOut = vm.envUint("MIN_OUT");
        vm.startBroadcast();
        EthToUsdgSwap helper = new EthToUsdgSwap(vm.envAddress("POOL"), vm.envAddress("WETH"));
        uint256 out = helper.swap{value: amount}(vm.envOr("RECIPIENT", msg.sender), minOut);
        vm.stopBroadcast();
        console.log("USDG received (base units):", out);
    }
}
