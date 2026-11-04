// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {ZenoFeedOracle} from "../../src/oracle/ZenoFeedOracle.sol";
import "../../src/credit/ZenoCreditProxies.sol";

// Fixtures are isolated unit tests, never public-testnet deployments or live-price evidence.
contract FeedFixture {
    uint8 public decimals;
    string public description;
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    constructor(uint8 d, string memory label, int256 value, uint256 started, uint256 updated) {
        decimals = d;
        description = label;
        answer = value;
        startedAt = started;
        updatedAt = updated;
    }

    function set(int256 value, uint256 started, uint256 updated, uint80 round, uint80 answered) external {
        answer = value;
        startedAt = started;
        updatedAt = updated;
        roundId = round;
        answeredInRound = answered;
    }

    function setDecimals(uint8 value) external {
        decimals = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}

contract StockStatusFixture {
    bool public oraclePaused;

    function pause() external {
        oraclePaused = true;
    }
}

contract ZenoFeedOracleTest is Test {
    StockStatusFixture stock;
    FeedFixture feed;
    FeedFixture sequencer;
    ZenoFeedOracle oracle;

    function inputs() internal view returns (ZenoFeedOracle.FeedInput[] memory values) {
        values = new ZenoFeedOracle.FeedInput[](1);
        values[0] = ZenoFeedOracle.FeedInput(address(stock), address(feed), "STOCK / USD", 120, 1e18, 10000e18, true);
    }

    function setUp() public {
        vm.warp(10000);
        stock = new StockStatusFixture();
        feed = new FeedFixture(8, "STOCK / USD", 250e8, 9900, 9990);
        sequencer = new FeedFixture(0, "Sequencer", 0, 100, 100);
        oracle = ZenoCreditProxies.oracle(address(this), block.chainid, address(sequencer), 60, inputs());
    }

    function testNormalizesFeedDecimalsWithoutReapplyingMultiplier() public view {
        assertEq(oracle.getPrice(address(stock)), 250e18);
    }

    function testRejectsUnknownAsset() public {
        vm.expectRevert(ZenoFeedOracle.UnknownAsset.selector);
        oracle.getPrice(address(123));
    }

    function testRejectsStaleAndFutureRounds() public {
        feed.set(250e8, 9000, 9000, 1, 1);
        vm.expectRevert(ZenoFeedOracle.StalePrice.selector);
        oracle.getPrice(address(stock));
        feed.set(250e8, 10000, 10001, 1, 1);
        vm.expectRevert(ZenoFeedOracle.InvalidRound.selector);
        oracle.getPrice(address(stock));
    }

    function testRejectsNonpositiveAndOutOfRangeAnswers() public {
        int256[3] memory values = [int256(0), int256(-1), int256(10001e8)];
        for (uint256 i; i < values.length; ++i) {
            feed.set(values[i], 9990, 9990, 1, 1);
            vm.expectRevert(ZenoFeedOracle.InvalidPrice.selector);
            oracle.getPrice(address(stock));
        }
    }

    function testRejectsIncompleteRound() public {
        feed.set(250e8, 9990, 9990, 2, 1);
        vm.expectRevert(ZenoFeedOracle.InvalidRound.selector);
        oracle.getPrice(address(stock));
    }

    function testSequencerOutageAndRecoveryGrace() public {
        sequencer.set(1, 9900, 9900, 2, 2);
        vm.expectRevert(ZenoFeedOracle.SequencerUnavailable.selector);
        oracle.getPrice(address(stock));
        sequencer.set(0, 9970, 9970, 3, 3);
        vm.expectRevert(ZenoFeedOracle.SequencerUnavailable.selector);
        oracle.getPrice(address(stock));
        vm.warp(10031);
        assertEq(oracle.getPrice(address(stock)), 250e18);
    }

    function testSequencerUninitializedAndFuture() public {
        sequencer.set(0, 0, 0, 1, 1);
        vm.expectRevert(ZenoFeedOracle.SequencerUnavailable.selector);
        oracle.getPrice(address(stock));
        sequencer.set(0, 10001, 10001, 1, 1);
        vm.expectRevert(ZenoFeedOracle.SequencerUnavailable.selector);
        oracle.getPrice(address(stock));
    }

    function testCorporateActionPauseBlocksReading() public {
        stock.pause();
        vm.expectRevert(ZenoFeedOracle.TokenOraclePaused.selector);
        oracle.getPrice(address(stock));
    }

    function testRejectsDecimalsChange() public {
        feed.setDecimals(18);
        vm.expectRevert(ZenoFeedOracle.InvalidPrice.selector);
        oracle.getPrice(address(stock));
    }

    function testRejectsWrongDescriptionAndDuplicateAssets() public {
        // Deploy the implementation first so expectRevert targets the initializing proxy.
        address implementation = address(new ZenoFeedOracle());
        ZenoFeedOracle.FeedInput[] memory values = inputs();
        values[0].description = "OTHER / USD";
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid, address(sequencer), 60, values);
        values = new ZenoFeedOracle.FeedInput[](2);
        values[0] = inputs()[0];
        values[1] = inputs()[0];
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid, address(sequencer), 60, values);
    }

    function testRejectsWrongChainAndMissingSequencer() public {
        // Deploy the implementation first so expectRevert targets the initializing proxy.
        address implementation = address(new ZenoFeedOracle());
        ZenoFeedOracle.FeedInput[] memory values = inputs();
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid + 1, address(sequencer), 60, values);
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid, address(0), 60, values);
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid, address(sequencer), 0, values);
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        ZenoCreditProxies.oracleAt(implementation, address(this), block.chainid, address(0xBEEF), 60, values);
    }

    function testWithoutSequencerFeedKeepsPriceChecks() public {
        oracle = ZenoCreditProxies.oracle(address(this), block.chainid, address(0), 0, inputs());
        assertEq(address(oracle.sequencerFeed()), address(0));
        assertEq(oracle.getPrice(address(stock)), 250e18);
        feed.set(250e8, 9000, 9000, 1, 1);
        vm.expectRevert(ZenoFeedOracle.StalePrice.selector);
        oracle.getPrice(address(stock));
        feed.set(250e8, 9990, 9990, 1, 1);
        stock.pause();
        vm.expectRevert(ZenoFeedOracle.TokenOraclePaused.selector);
        oracle.getPrice(address(stock));
    }

    function testSupportsHighDecimals() public {
        feed = new FeedFixture(20, "STOCK / USD", 250e20, 9900, 9990);
        oracle = ZenoCreditProxies.oracle(address(this), block.chainid, address(sequencer), 60, inputs());
        assertEq(oracle.getPrice(address(stock)), 250e18);
    }

    function testOwnerAddsFeedForNewAssetOnly() public {
        StockStatusFixture other = new StockStatusFixture();
        FeedFixture otherFeed = new FeedFixture(8, "OTHER / USD", 100e8, 9900, 9990);
        ZenoFeedOracle.FeedInput memory input =
            ZenoFeedOracle.FeedInput(address(other), address(otherFeed), "OTHER / USD", 120, 1e18, 10000e18, true);
        vm.expectRevert(ZenoFeedOracle.UnknownAsset.selector);
        oracle.getPrice(address(other));
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBAD)));
        oracle.addFeed(input);
        oracle.addFeed(input);
        assertEq(oracle.getPrice(address(other)), 100e18);
        // An existing feed is never replaced.
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        oracle.addFeed(input);
        input.asset = address(stock);
        vm.expectRevert(ZenoFeedOracle.InvalidConfiguration.selector);
        oracle.addFeed(input);
        assertEq(oracle.getPrice(address(stock)), 250e18);
    }

    function testUpgradeKeepsFeedsAndEnablesAddFeed() public {
        address next = address(new ZenoFeedOracle());
        oracle.upgradeToAndCall(next, "");
        assertEq(oracle.getPrice(address(stock)), 250e18);
        StockStatusFixture other = new StockStatusFixture();
        FeedFixture otherFeed = new FeedFixture(8, "OTHER / USD", 100e8, 9900, 9990);
        oracle.addFeed(
            ZenoFeedOracle.FeedInput(address(other), address(otherFeed), "OTHER / USD", 120, 1e18, 10000e18, true)
        );
        assertEq(oracle.getPrice(address(other)), 100e18);
    }
}
