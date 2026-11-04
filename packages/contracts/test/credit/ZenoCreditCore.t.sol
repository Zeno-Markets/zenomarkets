// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../mocks/CreditTestToken.sol";
import "../../src/oracle/ZenoCompositeSanityOracle.sol";
import "../../src/credit/ZenoCreditRegistry.sol";
import "../../src/credit/ZenoCreditPair.sol";
import "../../src/credit/ZenoCreditVault.sol";
import "../../src/credit/ZenoCreditRouter.sol";
import "../../src/credit/ZenoCreditProxies.sol";

contract ZenoCoreTest is Test {
    address admin = address(0xAD);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address keeper = address(0xCAFE);

    CreditTestToken nvda;
    CreditTestToken usdg;
    ZenoCompositeSanityOracle oracle;
    ZenoCreditRegistry registry;
    ZenoCreditPair pair;
    ZenoCreditVault vault;
    ZenoCreditRouter router;

    bytes32 marketId;

    function setUp() public {
        vm.startPrank(admin);

        // 1. Deploy Tokens
        nvda = new CreditTestToken("NVIDIA Token", "NVDA", 18, 1_000_000e18, admin);
        usdg = new CreditTestToken("Global Dollar", "USDG", 18, 10_000_000e18, admin);

        // 2. Deploy Oracle ($250.00 NVDA, $1.00 USDG)
        oracle = new ZenoCompositeSanityOracle(admin);
        oracle.setPrice(address(nvda), 250e18);
        oracle.setPrice(address(usdg), 1e18);

        // 3. Deploy Registry
        registry = ZenoCreditProxies.registry(admin);

        // 4. Deploy Dummy Pair Address for pre-calculation
        marketId = keccak256(abi.encodePacked("nvda-usdg-testnet", address(nvda), address(usdg)));

        // 5. Deploy Pair
        pair = ZenoCreditProxies.pair(marketId, address(nvda), address(usdg), address(oracle), address(registry), admin);

        // Register Market in Registry
        registry.addMarket(
            "nvda-usdg-testnet",
            address(nvda),
            address(usdg),
            address(pair),
            address(oracle),
            ZenoCreditRegistry.RiskTier.TierA,
            6000, // 60% Max LTV
            7000, // 70% Liquidation LTV
            25000, // 2.5x Max Leverage
            1_000_000e18,
            500_000e18
        );

        // 6. Deploy Vault
        vault = ZenoCreditProxies.vault(
            IERC20(address(usdg)), "Zeno USDG Yield Vault", "lvUSDG", "zeno-usdg-vault-testnet", "Conservative", admin
        );

        // 7. Deploy Routers
        router = ZenoCreditProxies.lendingRouter(address(this));
        vault.setDepositsPaused(false);

        // Provide liquidity to Pair
        usdg.transfer(address(pair), 100_000e18);

        // Fund Alice
        nvda.transfer(alice, 100e18); // 100 NVDA = $25,000
        usdg.transfer(alice, 10_000e18);

        // Fund Bob (liquidator)
        usdg.transfer(bob, 50_000e18);

        vm.stopPrank();
    }

    function testOraclePrices() public view {
        uint256 nvdaPrice = oracle.getPrice(address(nvda));
        assertEq(nvdaPrice, 250e18, "NVDA price should be 250 USD");

        uint256 usdgPrice = oracle.getPrice(address(usdg));
        assertEq(usdgPrice, 1e18, "USDG price should be 1 USD");
    }

    function testSupplyAndBorrowWithinLimit() public {
        vm.startPrank(alice);

        // Alice deposits 10 NVDA ($2,500 collateral)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);

        (uint256 col, uint256 debt, uint256 colValUsd, uint256 hf) = pair.getPosition(alice);
        assertEq(col, 10e18);
        assertEq(debt, 0);
        assertEq(colValUsd, 2500e18);
        assertEq(hf, 999_0000);

        // Max LTV is 60% of $2,500 = $1,500. Alice borrows 1,000 USDG (40% LTV, safe)
        pair.borrow(1000e18);

        (, debt,, hf) = pair.getPosition(alice);
        assertEq(debt, 1000e18);
        // Health factor: (Liquidation threshold $1,750 / debt $1,000) * 10,000 = 17500 (1.75)
        assertEq(hf, 17500);

        vm.stopPrank();
    }

    function testBorrowExceedingMaxLtvReverts() public {
        vm.startPrank(alice);

        // Alice deposits 10 NVDA ($2,500 collateral)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);

        // Max borrow is $1,500 (60% LTV). Attempting to borrow $1,600 must revert.
        vm.expectRevert("Pair: Borrow exceeds Max LTV limit");
        pair.borrow(1600e18);

        vm.stopPrank();
    }

    function testLiquidationWhenPriceDrops() public {
        vm.startPrank(alice);
        // Alice deposits 10 NVDA ($2,500 collateral) and borrows $1,500 USDG (60% LTV)
        nvda.approve(address(pair), 10e18);
        pair.depositCollateral(10e18);
        pair.borrow(1500e18);
        vm.stopPrank();

        // Admin updates NVDA price down to $200.00 (Collateral is now $2,000)
        // At $2,000 collateral, 70% liquidation threshold = $1,400. Debt is $1,500 -> Liquidatable!
        vm.prank(admin);
        oracle.forcePrice(address(nvda), 200e18);

        assertTrue(pair.isLiquidatable(alice), "Alice should now be liquidatable");

        // Bob liquidates Alice's position
        vm.startPrank(bob);
        usdg.approve(address(pair), 1500e18);
        pair.liquidate(alice, 1500e18);
        vm.stopPrank();

        (, uint256 debtRemaining,,) = pair.getPosition(alice);
        assertEq(debtRemaining, 0, "All debt should be liquidated");
    }
}
