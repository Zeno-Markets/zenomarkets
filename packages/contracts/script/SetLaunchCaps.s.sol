// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ZenoRiskManager} from "../src/risk/ZenoRiskManager.sol";
import {ZenoPriceValidator} from "../src/oracle/ZenoPriceValidator.sol";

/// @notice Applies the launch caps and the session-aware staleness limits from
/// `deployments/<network>.limits.json` to every listed market. It is the on-chain half of
/// `DEVELOPMENT_PHASES.md` Phase 4: without an audit these caps are the primary loss bound, so they are
/// sized against the settlement-token balance that actually exists, and they live in a data file rather
/// than in this script.
///
/// Every amount in that file is in settlement-token BASE UNITS, not whole tokens. At launch the whole
/// treasury is a fraction of one USDG, and `SetNetOpenInterest.s.sol`'s whole-token `VALUE` cannot
/// express a cap below 1 USDG.
///
/// What it sets per market:
///   - `ZenoPriceValidator.maxPriceAge`: the in-session limit, from `staleness.overrides[symbol]` or
///     `staleness.defaultSeconds`. Measured from the feeds' own round history, never widened to make a
///     market pass during its own session.
///   - `ZenoPriceValidator.tradingSession`: the underlying's hours in UTC, so that outside them the market
///     reads closed instead of halted, and so that a price carried over from an earlier session can
///     never settle. Re-run this on each US DST boundary.
///   - `ZenoRiskManager` per-wallet position cap and per-market open-interest cap, with the leverage and
///     margin numbers rebuilt from the market file exactly as `script/utils/MarketLister.sol` derived
///     them at listing: initial margin is `10000 / maxLeverage`, and the tiers are 1x, 2x, 3x, 5x, 10x
///     up to the maximum.
///   - `ZenoRiskManager.maxNetOpenInterest`: what the vault can be made to owe on a one-sided move.
///
/// It does not fund the vault pool; `FundPool.s.sol` does, with `poolReserveRaw` from the same file.
///
/// **It reads no chain state**, by design. An earlier version read each market's current risk config
/// back from `ZenoRiskManager` to preserve its leverage; against this chain's RPC that failed partway
/// through a `--slow` run with `error code -32000: historical state ... is not available`, because
/// `forge` pins the fork to one block and the node prunes state under it. Every value it needed is in
/// `deployments/<network>.markets.json` already, so the loop now only writes.
///
/// Set `SYMBOLS` to a comma-separated list to do a few markets at a time if a run is ever interrupted;
/// unset does every `tradeable` market in the file. Re-running is safe: every call sets an absolute
/// value, so a repeat is a no-op in effect.
///
/// Optional: NETWORK_NAME (default `robinhood_mainnet`), PRIVATE_KEY (needs `RISK_ADMIN_ROLE` and
/// `ORACLE_ADMIN_ROLE`; otherwise sign with the forge `--account` keystore).
///
/// Usage (dry run first; add --broadcast to send):
///   forge script script/SetLaunchCaps.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --account zeno-mainnet --sender <deployer> [--broadcast --slow]
contract SetLaunchCaps is Script {
    struct Caps {
        uint256 maxPosition;
        uint256 openInterestCap;
        uint256 maxNetOpenInterest;
        uint32 sessionOpen;
        uint32 sessionClose;
        uint8 sessionDays;
        uint32 preOpenGrace;
        uint256 defaultStaleness;
    }

    /// @dev Script state, not chain state: Solidity runs out of stack slots passing the three JSON
    /// documents and the caps through the per-market function as arguments.
    string internal _list;
    string internal _limits;
    string internal _only;
    Caps internal _caps;

    function run() external {
        string memory network = vm.envOr("NETWORK_NAME", string("robinhood_mainnet"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));
        string memory limits = vm.readFile(string.concat("deployments/", network, ".limits.json"));
        string memory list = vm.readFile(string.concat("deployments/", network, ".markets.json"));

        ZenoRiskManager risk = ZenoRiskManager(vm.parseJsonAddress(json, ".riskManager"));
        ZenoPriceValidator validator = ZenoPriceValidator(vm.parseJsonAddress(json, ".priceValidator"));

        _caps = Caps({
            maxPosition: vm.parseJsonUint(limits, ".caps.maxPositionRaw"),
            openInterestCap: vm.parseJsonUint(limits, ".caps.openInterestCapRaw"),
            maxNetOpenInterest: vm.parseJsonUint(limits, ".caps.maxNetOpenInterestRaw"),
            sessionOpen: uint32(vm.parseJsonUint(limits, ".session.openSecond")),
            sessionClose: uint32(vm.parseJsonUint(limits, ".session.closeSecond")),
            sessionDays: uint8(vm.parseJsonUint(limits, ".session.daysMask")),
            preOpenGrace: uint32(vm.parseJsonUint(limits, ".session.preOpenGraceSeconds")),
            defaultStaleness: vm.parseJsonUint(limits, ".staleness.defaultSeconds")
        });
        require(_caps.maxNetOpenInterest > 0, "net open interest cap must be above zero");
        require(_caps.openInterestCap >= _caps.maxPosition, "open interest cap must be at least the position cap");
        require(_caps.maxPosition > 0, "position cap must be above zero");
        _list = list;
        _limits = limits;
        _only = vm.envOr("SYMBOLS", string(""));

        uint256 count = abi.decode(vm.parseJson(list, ".markets[*].symbol"), (string[])).length;

        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key == 0) vm.startBroadcast();
        else vm.startBroadcast(key);
        uint256 done;
        for (uint256 i; i < count; i++) {
            if (_applyOne(risk, validator, i)) done++;
        }
        vm.stopBroadcast();
        console.log("Markets updated:", done);
    }

    /// @dev True when `symbol` is in the comma-separated `only` list, or when that list is empty.
    function _selected(string memory only, string memory symbol) internal pure returns (bool) {
        if (bytes(only).length == 0) return true;
        bytes memory haystack = bytes(only);
        bytes memory needle = bytes(symbol);
        for (uint256 i; i + needle.length <= haystack.length; i++) {
            bool hit = true;
            for (uint256 j; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (!hit) continue;
            bool startOk = i == 0 || haystack[i - 1] == ",";
            uint256 end = i + needle.length;
            bool endOk = end == haystack.length || haystack[end] == ",";
            if (startOk && endOk) return true;
        }
        return false;
    }

    /// @dev The leverage tiers a market was listed with: 1x, 2x, 3x, 5x, 10x up to its maximum. Same
    /// derivation as `script/utils/MarketLister.sol`, so this script writes back what is already there.
    function _tiers(uint256 maxLeverage) internal pure returns (uint256[] memory tiers) {
        uint256[5] memory all = [uint256(1), 2, 3, 5, 10];
        uint256 n;
        for (uint256 i; i < all.length; i++) {
            if (all[i] <= maxLeverage) n++;
        }
        tiers = new uint256[](n);
        for (uint256 i; i < n; i++) {
            tiers[i] = all[i];
        }
    }

    function _isCrypto(string memory list, string memory path) internal view returns (bool) {
        string memory key = string.concat(path, ".group");
        return
            vm.keyExistsJson(list, key) && keccak256(bytes(vm.parseJsonString(list, key))) == keccak256(bytes("crypto"));
    }

    function _applyOne(ZenoRiskManager risk, ZenoPriceValidator validator, uint256 i) internal returns (bool) {
        string memory list = _list;
        string memory path = string.concat(".markets[", vm.toString(i), "]");
        string memory symbol = vm.parseJsonString(list, string.concat(path, ".symbol"));
        if (!_selected(_only, symbol)) return false;

        // Only a tradeable entry is listed on chain; a quoted or listed one has no feed and no market.
        string memory tierKey = string.concat(path, ".tier");
        if (
            vm.keyExistsJson(list, tierKey)
                && keccak256(bytes(vm.parseJsonString(list, tierKey))) != keccak256(bytes("tradeable"))
        ) {
            console.log("skip, display only:", symbol);
            return false;
        }

        bytes32 id = bytes32(bytes(symbol));
        uint256 staleness = _caps.defaultStaleness;
        string memory key = string.concat(".staleness.overrides.", symbol);
        if (vm.keyExistsJson(_limits, key)) staleness = vm.parseJsonUint(_limits, key);

        validator.setMaxPriceAge(id, staleness);
        // A crypto entry (BTC, ETH, LINK, GLD) is a feed-only market that trades around the clock, so it gets no
        // session: the session floor would close it at the weekend.
        if (!_isCrypto(list, path)) {
            validator.setTradingSession(
                id, _caps.sessionOpen, _caps.sessionClose, _caps.sessionDays, _caps.preOpenGrace
            );
        }

        uint256 maxLeverage = vm.parseJsonUint(list, string.concat(path, ".maxLeverage"));
        risk.setRiskConfig(
            id,
            ZenoRiskManager.RiskConfig({
                maxLeverage: maxLeverage,
                allowedLeverageTiers: _tiers(maxLeverage),
                initialMarginRateBps: 10_000 / maxLeverage,
                maintenanceMarginRateBps: vm.parseJsonUint(list, string.concat(path, ".maintenanceBps")),
                maxPositionNotional: _caps.maxPosition,
                openInterestCap: _caps.openInterestCap
            })
        );
        risk.setMaxNetOpenInterest(id, _caps.maxNetOpenInterest);

        console.log(symbol, "staleness seconds:", staleness);
        return true;
    }
}
