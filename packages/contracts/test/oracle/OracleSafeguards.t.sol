// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseTest} from "../utils/BaseTest.sol";
import {ZenoPriceValidator} from "../../src/oracle/ZenoPriceValidator.sol";
import {ZenoOracleRouter} from "../../src/oracle/ZenoOracleRouter.sol";
import {ZenoTestnetFeed} from "../../src/oracle/ZenoTestnetFeed.sol";

/// @dev The oracle safeguards PROJECT_BRIEF.md Section 16 requires: stale-price rejection,
/// deviation rejection, a fallback source, and an emergency pause.
contract OracleSafeguardsTest is BaseTest {
    ZenoTestnetFeed internal fallbackFeed;

    function _addFallback(uint256 price) internal {
        vm.startPrank(admin);
        fallbackFeed = new ZenoTestnetFeed(admin, 18, price);
        oracleRouter.setFallbackSource(NVDA, address(fallbackFeed), 18);
        vm.stopPrank();
    }

    // ---- ZenoPriceValidator -----------------------------------------------------

    function test_validator_freshnessUsesDefaultAndOverride() public {
        uint256 ts = block.timestamp;
        vm.warp(ts + 1 hours);
        priceValidator.validateFreshness(ts, NVDA); // exactly at the limit is still fresh
        vm.warp(ts + 1 hours + 1);
        vm.expectRevert(ZenoPriceValidator.StaleOraclePrice.selector);
        priceValidator.validateFreshness(ts, NVDA);

        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);
        priceValidator.validateFreshness(ts, NVDA);
    }

    function test_validator_deviationUsesDefaultAndOverride() public {
        priceValidator.validateDeviation(100e18, 110e18, NVDA); // 9.09% is inside the 10% default
        vm.expectRevert(ZenoPriceValidator.InvalidOraclePrice.selector);
        priceValidator.validateDeviation(100e18, 120e18, NVDA);
        vm.expectRevert(ZenoPriceValidator.InvalidOraclePrice.selector);
        priceValidator.validateDeviation(120e18, 100e18, NVDA); // symmetric

        vm.prank(admin);
        priceValidator.setMaxDeviationBps(NVDA, 2500);
        priceValidator.validateDeviation(100e18, 120e18, NVDA);
    }

    function test_validator_zeroPriceIsIgnored() public view {
        priceValidator.validateDeviation(0, 100e18, NVDA);
        priceValidator.validateDeviation(100e18, 0, NVDA);
    }

    // ---- Session-aware staleness (REFERENCE.md Section 2, Finding 4) --------

    /// @dev The launch window for the 32 US equity markets: 13:30 to 20:30 UTC, Monday to Friday.
    uint32 internal constant SESSION_OPEN = 13 hours + 30 minutes;
    uint32 internal constant SESSION_CLOSE = 20 hours + 30 minutes;
    uint8 internal constant WEEKDAYS = 0x1F;
    uint32 internal constant PRE_OPEN_GRACE = 90 minutes;

    /// 2026-10-02 is a Friday; 16:00 UTC is inside the session, 23:00 UTC is after it.
    uint256 internal constant FRIDAY_IN_SESSION = 1_790_899_200 + 16 hours;
    uint256 internal constant FRIDAY_AFTER_CLOSE = 1_790_899_200 + 23 hours;
    /// 2026-10-04 is a Sunday.
    uint256 internal constant SUNDAY_NOON = 1_791_072_000 + 12 hours;

    function _setEquitySession() internal {
        vm.prank(admin);
        priceValidator.setTradingSession(NVDA, SESSION_OPEN, SESSION_CLOSE, WEEKDAYS, PRE_OPEN_GRACE);
    }

    function test_validator_inSessionKeepsTheTightLimit() public {
        _setEquitySession();
        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);

        vm.warp(FRIDAY_IN_SESSION);
        priceValidator.validateFreshness(FRIDAY_IN_SESSION - 2 hours, NVDA);
        assertEq(
            uint8(priceValidator.priceState(FRIDAY_IN_SESSION - 2 hours, NVDA)), uint8(ZenoPriceValidator.PriceState.Fresh)
        );

        // A feed that stops updating during its own session is broken, not closed.
        vm.expectRevert(ZenoPriceValidator.StaleOraclePrice.selector);
        priceValidator.validateFreshness(FRIDAY_IN_SESSION - 2 hours - 1, NVDA);
        assertEq(
            uint8(priceValidator.priceState(FRIDAY_IN_SESSION - 2 hours - 1, NVDA)),
            uint8(ZenoPriceValidator.PriceState.Stale)
        );
    }

    function test_validator_outsideSessionReadsClosedNotHalted() public {
        _setEquitySession();
        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 2 hours);

        // The measured weekend case: a 40-hour-old answer on a Sunday reads closed, not stale.
        vm.warp(SUNDAY_NOON);
        assertEq(
            uint8(priceValidator.priceState(SUNDAY_NOON - 40 hours, NVDA)), uint8(ZenoPriceValidator.PriceState.Closed)
        );
        vm.expectRevert(abi.encodeWithSelector(ZenoPriceValidator.MarketSessionClosed.selector, NVDA));
        priceValidator.validateFreshness(SUNDAY_NOON - 40 hours, NVDA);

        // Same on a weekday evening, and a fresh price does not reopen a closed market.
        vm.warp(FRIDAY_AFTER_CLOSE);
        vm.expectRevert(abi.encodeWithSelector(ZenoPriceValidator.MarketSessionClosed.selector, NVDA));
        priceValidator.validateFreshness(FRIDAY_AFTER_CLOSE, NVDA);
    }

    function test_validator_sessionFloorRejectsAnEarlierSessionsPrice() public {
        _setEquitySession();
        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 8 hours); // loose enough to survive a quiet session

        // 16:00 UTC on Friday. Today's open was 13:30 and the grace reaches back to 12:00.
        vm.warp(FRIDAY_IN_SESSION);
        uint256 floor_ = priceValidator.sessionFloor(NVDA, vm.getBlockTimestamp());
        assertEq(floor_, 1_790_899_200 + SESSION_OPEN - PRE_OPEN_GRACE);

        priceValidator.validateFreshness(floor_, NVDA); // the last print before the bell counts
        assertEq(uint8(priceValidator.priceState(floor_, NVDA)), uint8(ZenoPriceValidator.PriceState.Fresh));

        // A price from before the grace is Thursday's, and the age limit alone would have passed it.
        vm.expectRevert(ZenoPriceValidator.StaleOraclePrice.selector);
        priceValidator.validateFreshness(floor_ - 1, NVDA);
        assertEq(uint8(priceValidator.priceState(floor_ - 1, NVDA)), uint8(ZenoPriceValidator.PriceState.Stale));
    }

    function test_validator_sessionFloorHoldsForAQuietSession() public {
        // The measured SPY case: one print just before the open, then nothing for the whole session.
        _setEquitySession();
        vm.prank(admin);
        priceValidator.setMaxPriceAge(NVDA, 8 hours);

        uint256 lastPrint = 1_790_899_200 + SESSION_OPEN - 1 hours;
        vm.warp(1_790_899_200 + SESSION_CLOSE);
        priceValidator.validateFreshness(lastPrint, NVDA); // quiet, not broken: still tradeable
        assertEq(uint8(priceValidator.priceState(lastPrint, NVDA)), uint8(ZenoPriceValidator.PriceState.Fresh));
    }

    function test_validator_noSessionHasNoFloor() public view {
        assertEq(priceValidator.sessionFloor(NVDA, vm.getBlockTimestamp()), 0);
    }

    function test_validator_sessionBoundsAreInclusive() public {
        _setEquitySession();
        uint256 midnight = 1_790_899_200; // 2026-10-02 00:00 UTC, a Friday

        vm.warp(midnight + SESSION_OPEN);
        assertTrue(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
        vm.warp(midnight + SESSION_OPEN - 1);
        assertFalse(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
        vm.warp(midnight + SESSION_CLOSE);
        assertTrue(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
        vm.warp(midnight + SESSION_CLOSE + 1);
        assertFalse(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
    }

    function test_validator_holidayClosesAWeekday() public {
        _setEquitySession();
        vm.warp(FRIDAY_IN_SESSION);
        assertTrue(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));

        vm.prank(admin);
        priceValidator.setSessionHoliday(NVDA, FRIDAY_IN_SESSION / 1 days, true);
        assertFalse(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
        assertEq(
            uint8(priceValidator.priceState(vm.getBlockTimestamp(), NVDA)), uint8(ZenoPriceValidator.PriceState.Closed)
        );
    }

    function test_validator_noSessionMeansAlwaysOpen() public {
        // An unconfigured market keeps the pre-session behaviour: a crypto, FX or stablecoin feed
        // never closes, so only the age limit applies.
        vm.warp(SUNDAY_NOON);
        assertTrue(priceValidator.isSessionOpen(NVDA, vm.getBlockTimestamp()));
        priceValidator.validateFreshness(SUNDAY_NOON - 1 minutes, NVDA);
        vm.expectRevert(ZenoPriceValidator.StaleOraclePrice.selector);
        priceValidator.validateFreshness(SUNDAY_NOON - 2 hours, NVDA);
    }

    function test_validator_sessionSetterRejectsNonsense() public {
        vm.startPrank(admin);
        vm.expectRevert(ZenoPriceValidator.InvalidTradingSession.selector);
        priceValidator.setTradingSession(NVDA, SESSION_CLOSE, SESSION_OPEN, WEEKDAYS, PRE_OPEN_GRACE); // open after close
        vm.expectRevert(ZenoPriceValidator.InvalidTradingSession.selector);
        priceValidator.setTradingSession(NVDA, SESSION_OPEN, 86_400, WEEKDAYS, PRE_OPEN_GRACE); // close past midnight
        vm.expectRevert(ZenoPriceValidator.InvalidTradingSession.selector);
        priceValidator.setTradingSession(NVDA, SESSION_OPEN, SESSION_CLOSE, 0, PRE_OPEN_GRACE); // no days
        vm.expectRevert(ZenoPriceValidator.InvalidTradingSession.selector);
        priceValidator.setTradingSession(NVDA, SESSION_OPEN, 0, WEEKDAYS, 0); // clearing takes zeroes

        priceValidator.setTradingSession(NVDA, SESSION_OPEN, SESSION_CLOSE, WEEKDAYS, PRE_OPEN_GRACE);
        priceValidator.setTradingSession(NVDA, 0, 0, 0, 0); // clearing is allowed
        (, uint32 closeSecond,,) = priceValidator.tradingSession(NVDA);
        assertEq(closeSecond, 0);
        vm.stopPrank();
    }

    function test_validator_sessionSettersAreAdminOnly() public {
        vm.startPrank(alice);
        vm.expectRevert();
        priceValidator.setTradingSession(NVDA, SESSION_OPEN, SESSION_CLOSE, WEEKDAYS, PRE_OPEN_GRACE);
        vm.expectRevert();
        priceValidator.setSessionHoliday(NVDA, 0, true);
        vm.stopPrank();
    }

    function test_validator_settersAreAdminOnly() public {
        vm.startPrank(alice);
        vm.expectRevert();
        priceValidator.setMaxPriceAge(NVDA, 1);
        vm.expectRevert();
        priceValidator.setMaxDeviationBps(NVDA, 1);
        vm.stopPrank();
    }

    function testFuzz_validator_deviationIsSymmetric(uint128 a, uint128 b) public {
        bool aThenB;
        try priceValidator.validateDeviation(a, b, NVDA) {
            aThenB = true;
        } catch {}
        bool bThenA;
        try priceValidator.validateDeviation(b, a, NVDA) {
            bThenA = true;
        } catch {}
        assertEq(aThenB, bThenA);
    }

    // ---- fallback source ----------------------------------------------------

    function test_router_fallbackServesWhenPrimaryIsStale() public {
        _addFallback(190e18);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(admin);
        fallbackFeed.setPrice(191e18); // only the fallback is fresh

        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 191e18);
    }

    function test_router_primaryWinsWhenBothAgree() public {
        _addFallback(195e18);
        (uint256 price,) = oracleRouter.getIndexPrice(NVDA);
        assertEq(price, 190e18);
    }

    function test_router_deviatingSourcesReject() public {
        _addFallback(230e18); // 190 vs 230 is far beyond 10%
        vm.expectRevert(ZenoPriceValidator.InvalidOraclePrice.selector);
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_router_noFreshSourceReverts() public {
        _addFallback(190e18);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(ZenoOracleRouter.NoPriceSource.selector, NVDA));
        oracleRouter.getIndexPrice(NVDA);
    }

    function test_router_unknownMarketHasNoSource() public {
        vm.expectRevert(abi.encodeWithSelector(ZenoOracleRouter.NoPriceSource.selector, bytes32("TSLA")));
        oracleRouter.getIndexPrice("TSLA");
    }

    function test_router_normalizesDecimals() public {
        vm.startPrank(admin);
        ZenoTestnetFeed eightDecimals = new ZenoTestnetFeed(admin, 8, 190e8);
        ZenoTestnetFeed twentyDecimals = new ZenoTestnetFeed(admin, 20, 190e20);
        oracleRouter.setPrimarySource("A8", address(eightDecimals), 8);
        oracleRouter.setPrimarySource("A20", address(twentyDecimals), 20);
        vm.stopPrank();

        (uint256 up,) = oracleRouter.getIndexPrice("A8");
        (uint256 down,) = oracleRouter.getIndexPrice("A20");
        assertEq(up, 190e18);
        assertEq(down, 190e18);
    }

    function test_router_adminSettersRejectZeroAndNonAdmins() public {
        vm.prank(admin);
        vm.expectRevert(ZenoOracleRouter.ZeroAddress.selector);
        oracleRouter.setPrimarySource(NVDA, address(0), 18);

        vm.startPrank(alice);
        vm.expectRevert();
        oracleRouter.setPrimarySource(NVDA, address(1), 18);
        vm.expectRevert();
        oracleRouter.setFallbackSource(NVDA, address(1), 18);
        vm.expectRevert();
        oracleRouter.pauseMarket(NVDA);
        vm.stopPrank();
    }

    function test_router_lastPriceAndSettlementReads() public {
        (uint256 last,) = oracleRouter.getLastPrice(NVDA);
        assertEq(last, 0);

        uint256 expiry = block.timestamp + 1 days;
        vm.expectRevert(abi.encodeWithSelector(ZenoOracleRouter.SettlementNotRecorded.selector, NVDA, expiry));
        oracleRouter.getSettlementPrice(NVDA, expiry);

        vm.warp(expiry);
        _setPrice(200e18);
        oracleRouter.ensureSettlementPrice(NVDA, expiry);
        (uint256 settled, uint256 at) = oracleRouter.getSettlementPrice(NVDA, expiry);
        assertEq(settled, 200e18);
        assertEq(at, expiry);
        (uint256 price,) = oracleRouter.getPrice(NVDA);
        assertEq(price, 200e18);
    }

    function test_mockFeed_onlyOwnerCanPush() public {
        vm.prank(alice);
        vm.expectRevert(ZenoTestnetFeed.NotOwner.selector);
        priceFeed.setPrice(1);
        assertEq(priceFeed.decimals(), 18);
    }
}
