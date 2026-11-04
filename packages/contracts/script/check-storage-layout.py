#!/usr/bin/env python3
"""Fails when a change breaks the storage layout of an upgradeable contract.

Every protocol contract lives behind a proxy that keeps its state across upgrades, so a new
implementation must keep the layout of the old one: appending a state variable is fine, reordering,
removing or retyping one corrupts the state that is already on chain.

The reference layouts are checked in under `storage-layouts/`. Run `script/check-storage-layout.py` to
compare, and `script/check-storage-layout.py --update` after a deliberate change (for example a new
variable at the end) or after a fresh deployment that resets the state.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = ROOT / "storage-layouts"

CONTRACTS = {
    "ZenoMarketRegistry": "src/core/ZenoMarketRegistry.sol",
    "ZenoCollateralManager": "src/core/ZenoCollateralManager.sol",
    "ZenoVault": "src/core/ZenoVault.sol",
    "ZenoFeeManager": "src/core/ZenoFeeManager.sol",
    "ZenoBuybackModule": "src/core/ZenoBuybackModule.sol",
    "ZenoPriceValidator": "src/oracle/ZenoPriceValidator.sol",
    "ZenoOracleRouter": "src/oracle/ZenoOracleRouter.sol",
    "ZenoRiskManager": "src/risk/ZenoRiskManager.sol",
    "ZenoOptionPositionManager": "src/options/ZenoOptionPositionManager.sol",
    "ZenoOptionMarket": "src/options/ZenoOptionMarket.sol",
    "ZenoOptionsEngine": "src/options/ZenoOptionsEngine.sol",
    "ZenoPerpPositionManager": "src/perps/ZenoPerpPositionManager.sol",
    "ZenoPerpOrderManager": "src/perps/ZenoPerpOrderManager.sol",
    "ZenoFundingManager": "src/perps/ZenoFundingManager.sol",
    "ZenoPerpsEngine": "src/perps/ZenoPerpsEngine.sol",
    "ZenoLiquidationEngine": "src/perps/ZenoLiquidationEngine.sol",
    "ZenoInsuranceFund": "src/core/ZenoInsuranceFund.sol",
    "ZenoCrossMarginManager": "src/risk/ZenoCrossMarginManager.sol",
    "ZenoSubaccountFactory": "src/accounts/ZenoSubaccountFactory.sol",
    "ZenoRFQManager": "src/perps/ZenoRFQManager.sol",
}


def norm(type_id: str) -> str:
    """Drops the AST id that follows a type name: it changes with any unrelated edit."""
    return re.sub(r"\)\d+", ")", type_id)


def layout(name: str, path: str) -> dict:
    out = subprocess.run(
        ["forge", "inspect", f"{path}:{name}", "storage-layout", "--json"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    raw = json.loads(out)
    storage = [
        {"label": s["label"], "slot": s["slot"], "offset": s["offset"], "type": norm(s["type"])}
        for s in raw["storage"]
    ]
    types = {}
    for key, t in raw["types"].items():
        entry = {k: v for k, v in t.items() if k not in ("members", "base", "key", "value")}
        for k in ("base", "key", "value"):
            if k in t:
                entry[k] = norm(t[k])
        if "members" in t:
            entry["members"] = [
                {"label": m["label"], "slot": m["slot"], "offset": m["offset"], "type": norm(m["type"])}
                for m in t["members"]
            ]
        types[norm(key)] = entry
    return {"storage": storage, "types": types}


def problems(name: str, old: dict, new: dict) -> list:
    found = []
    for i, var in enumerate(old["storage"]):
        if i >= len(new["storage"]) or new["storage"][i] != var:
            now = new["storage"][i] if i < len(new["storage"]) else "missing"
            found.append(f"{name}: slot entry {i} `{var['label']}` changed (was {var}, now {now})")
    for key, entry in old["types"].items():
        if key in new["types"] and new["types"][key] != entry:
            found.append(f"{name}: type {key} changed (a struct member was reordered, removed or retyped)")
    return found


def main() -> int:
    update = "--update" in sys.argv
    BASELINE.mkdir(exist_ok=True)
    failed = []
    for name, path in CONTRACTS.items():
        current = layout(name, path)
        file = BASELINE / f"{name}.json"
        if update or not file.exists():
            file.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
            continue
        failed += problems(name, json.loads(file.read_text()), current)
    if update:
        print(f"storage layouts written to {BASELINE.relative_to(ROOT)}/")
        return 0
    if failed:
        print("\n".join(f"!!! {line}" for line in failed))
        print("A proxy keeps its state across an upgrade: only append state variables. If this change")
        print("is meant to reset the state, deploy fresh with DeployAll and rerun with --update.")
        return 1
    print(f"storage layout: all {len(CONTRACTS)} contracts keep their layout")
    return 0


if __name__ == "__main__":
    sys.exit(main())
