// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UpgradeableBase} from "../proxy/UpgradeableBase.sol";

/// @notice Stateless-ish price validation (staleness + deviation), kept separate from
/// ZenoOracleRouter so the rules are independently unit- and fuzz-testable (PROJECT_BRIEF.md
/// Section 16). Reverts use the exact error signatures required by Section 36.
///
/// Staleness is session-aware (`REFERENCE.md` Section 2, Finding 4). Every Chainlink feed on this
/// chain updates on a 0.5% deviation or a 24-hour heartbeat, so an equity feed is stale every night
/// and all weekend by design: measured on 2026-10-04, a Sunday, all 32 equity feeds read 35.7 to
/// 46.0 hours old. A flat one-hour limit would therefore close the venue every evening, and a flat
/// 25-hour limit would let someone trade on a day-old price. So each market carries a trading
/// session, and the market has three states rather than two:
///
/// - inside the session, a price newer than `maxPriceAge` that also belongs to the session now
///   running is `Fresh` and may be settled on;
/// - inside the session, an older price, or one carried over from an earlier session, is `Stale`, and
///   `validateFreshness` reverts `StaleOraclePrice`: the feed has broken during the hours it is
///   supposed to work;
/// - outside the session the market is `Closed`, and `validateFreshness` reverts
///   `MarketSessionClosed`, which is a normal state and not a fault. The frontend reads
///   `priceState` and renders the last price, its timestamp and a disabled ticket, the way an
///   equity venue does, instead of an oracle error.
///
/// The session floor is the rule that does the work. A feed only moves on a 0.5% deviation, so a long
/// in-session silence usually means the price has not moved: measured over three weeks of round
/// history, SPY went a whole 390-minute session without one update, and MSFT, NVDA and AAPL ran over
/// five hours. An age limit tight enough to catch a broken feed would therefore halt a quiet market
/// during its own session, and one loose enough to survive a quiet session would also admit
/// yesterday's close - the price across which the underlying can gap arbitrarily. So a price must
/// additionally be stamped at or after this session's open, less `preOpenGrace` for the feed that
/// last printed shortly before the bell (measured at up to 39 minutes after the open for the first
/// in-session print, and SPY's last pre-open print an hour before it). A previous session's price can
/// never pass, whatever `maxPriceAge` says.
///
/// A market with no session configured is always in session, which is the right default for a
/// crypto, FX or stablecoin feed: those never close, and deviation is the only thing that moves
/// them, so they take the full 24-hour tolerance through `maxPriceAge` alone.
///
/// The session window is stored in UTC, but the US equity session moves against UTC twice a year
/// (13:30-20:00 UTC under EDT, 14:30-21:00 UTC under EST). `setTradingSession` is therefore an
/// operational task on each DST boundary - the first after launch is 2026-11-01. Forgetting it is
/// conservative rather than dangerous: the window then reads open for an hour when the underlying
/// is shut, the feed is stale for that hour, and trading reverts instead of pricing off a stale
/// feed. It never widens a limit.
contract ZenoPriceValidator is UpgradeableBase {
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");

    uint256 public constant DEFAULT_MAX_PRICE_AGE = 1 hours;
    uint256 public constant DEFAULT_MAX_DEVIATION_BPS = 1000; // 10%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_DAY = 86_400;
    /// @notice 1970-01-01 was a Thursday, so this shifts the day count onto a Monday-first week.
    uint256 private constant DAY_OF_WEEK_OFFSET = 3;

    /// @notice What a price may be used for right now. `Fresh` settles; the other two do not.
    enum PriceState {
        Fresh,
        Closed,
        Stale
    }

    /// @notice One market's trading session, in UTC. `openSecond` and `closeSecond` are seconds from
    /// UTC midnight, with `closeSecond` inclusive so a settlement taken exactly at the close still
    /// reads in session. `daysMask` has bit 0 for Monday through bit 6 for Sunday. `preOpenGrace` is
    /// how far before the open a price may be stamped and still count as belonging to this session. A
    /// session whose `closeSecond` is 0 is not configured, and that market is always in session.
    struct TradingSession {
        uint32 openSecond;
        uint32 closeSecond;
        uint8 daysMask;
        uint32 preOpenGrace;
    }

    /// @notice Per-market override; 0 means "use the default". Inside the session only.
    mapping(bytes32 => uint256) public maxPriceAge;
    /// @notice Per-market override; 0 means "use the default".
    mapping(bytes32 => uint256) public maxDeviationBps;
    /// @notice Per-market trading session; an unset one means the market never closes.
    mapping(bytes32 => TradingSession) public tradingSession;
    /// @notice Days the market is shut although `tradingSession` says otherwise, keyed by
    /// `timestamp / 1 days`. A US market holiday falls on a weekday, so without this the window
    /// would read open while every feed sits at its overnight age and the market would read halted
    /// rather than closed.
    mapping(bytes32 => mapping(uint256 => bool)) public sessionHoliday;

    event MaxPriceAgeUpdated(bytes32 indexed marketId, uint256 value);
    event MaxDeviationUpdated(bytes32 indexed marketId, uint256 valueBps);
    event TradingSessionUpdated(
        bytes32 indexed marketId, uint32 openSecond, uint32 closeSecond, uint8 daysMask, uint32 preOpenGrace
    );
    event SessionHolidayUpdated(bytes32 indexed marketId, uint256 indexed day, bool closed);

    error StaleOraclePrice();
    error InvalidOraclePrice();
    /// @notice The underlying's session is shut. A normal state, not a broken feed.
    error MarketSessionClosed(bytes32 marketId);
    error InvalidTradingSession();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __UpgradeableBase_init(admin);
        _grantRole(ORACLE_ADMIN_ROLE, admin);
    }

    function setMaxPriceAge(bytes32 marketId, uint256 value) external onlyRole(ORACLE_ADMIN_ROLE) {
        maxPriceAge[marketId] = value;
        emit MaxPriceAgeUpdated(marketId, value);
    }

    function setMaxDeviationBps(bytes32 marketId, uint256 value) external onlyRole(ORACLE_ADMIN_ROLE) {
        maxDeviationBps[marketId] = value;
        emit MaxDeviationUpdated(marketId, value);
    }

    /// @notice Sets the hours the underlying trades. `closeSecond` 0 clears the session, which makes
    /// the market always in session - correct for a feed that never closes, wrong for an equity.
    function setTradingSession(
        bytes32 marketId,
        uint32 openSecond,
        uint32 closeSecond,
        uint8 daysMask,
        uint32 preOpenGrace
    ) external onlyRole(ORACLE_ADMIN_ROLE) {
        if (closeSecond == 0) {
            if (openSecond != 0 || daysMask != 0 || preOpenGrace != 0) revert InvalidTradingSession();
            delete tradingSession[marketId];
        } else {
            if (
                openSecond >= closeSecond || closeSecond >= SECONDS_PER_DAY || daysMask == 0 || daysMask > 0x7F
                    || preOpenGrace > SECONDS_PER_DAY
            ) {
                revert InvalidTradingSession();
            }
            tradingSession[marketId] = TradingSession(openSecond, closeSecond, daysMask, preOpenGrace);
        }
        emit TradingSessionUpdated(marketId, openSecond, closeSecond, daysMask, preOpenGrace);
    }

    /// @notice Marks one UTC day (`timestamp / 1 days`) shut for a market, for a market holiday.
    function setSessionHoliday(bytes32 marketId, uint256 day, bool closed) external onlyRole(ORACLE_ADMIN_ROLE) {
        sessionHoliday[marketId][day] = closed;
        emit SessionHolidayUpdated(marketId, day, closed);
    }

    /// @notice True when `timestamp` falls inside the market's session. A market with no session
    /// configured is always in session.
    function isSessionOpen(bytes32 marketId, uint256 timestamp) public view returns (bool) {
        TradingSession memory session = tradingSession[marketId];
        if (session.closeSecond == 0) return true;
        uint256 day = timestamp / SECONDS_PER_DAY;
        if (sessionHoliday[marketId][day]) return false;
        if (session.daysMask & uint8(1 << ((day + DAY_OF_WEEK_OFFSET) % 7)) == 0) return false;
        uint256 secondOfDay = timestamp % SECONDS_PER_DAY;
        return secondOfDay >= session.openSecond && secondOfDay <= session.closeSecond;
    }

    /// @notice The earliest timestamp a price may carry and still belong to the session running at
    /// `timestamp`. Zero when the market has no session, which has no floor.
    function sessionFloor(bytes32 marketId, uint256 timestamp) public view returns (uint256) {
        TradingSession memory session = tradingSession[marketId];
        if (session.closeSecond == 0) return 0;
        uint256 open = (timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY + session.openSecond;
        return open > session.preOpenGrace ? open - session.preOpenGrace : 0;
    }

    /// @notice The state a price of age `block.timestamp - timestamp` is in right now, for a market
    /// whose session is judged at `block.timestamp`. Read by the frontend and the services so a
    /// closed market renders as closed without catching a revert.
    function priceState(uint256 timestamp, bytes32 marketId) public view returns (PriceState) {
        if (!isSessionOpen(marketId, block.timestamp)) return PriceState.Closed;
        uint256 maxAge = maxPriceAge[marketId];
        if (maxAge == 0) maxAge = DEFAULT_MAX_PRICE_AGE;
        if (block.timestamp > timestamp + maxAge) return PriceState.Stale;
        if (timestamp < sessionFloor(marketId, block.timestamp)) return PriceState.Stale;
        return PriceState.Fresh;
    }

    /// @notice Reverts unless the price may be settled on: `MarketSessionClosed` outside the
    /// underlying's session, and `StaleOraclePrice` when the price is older than the market's max
    /// price age during it. The in-session limit is never widened to make a market pass - that
    /// would trade on a stale price.
    function validateFreshness(uint256 timestamp, bytes32 marketId) external view {
        PriceState state = priceState(timestamp, marketId);
        if (state == PriceState.Closed) revert MarketSessionClosed(marketId);
        if (state == PriceState.Stale) revert StaleOraclePrice();
    }

    /// @notice Reverts with `InvalidOraclePrice` if the two prices deviate by more than
    /// the market's max deviation. Used to cross-validate primary against fallback.
    function validateDeviation(uint256 priceA, uint256 priceB, bytes32 marketId) external view {
        if (priceA == 0 || priceB == 0) return;

        uint256 maxDev = maxDeviationBps[marketId];
        if (maxDev == 0) maxDev = DEFAULT_MAX_DEVIATION_BPS;

        uint256 diff = priceA > priceB ? priceA - priceB : priceB - priceA;
        uint256 base = priceA > priceB ? priceA : priceB;
        uint256 deviationBps = (diff * BPS_DENOMINATOR) / base;
        if (deviationBps > maxDev) revert InvalidOraclePrice();
    }
}
