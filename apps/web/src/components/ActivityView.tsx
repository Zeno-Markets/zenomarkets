"use client";

import { Panel, Tabs } from "@zeno/ui";
import { useState } from "react";
import { useAccountMode } from "@/hooks/useAccountMode";
import { ConnectButton } from "./ConnectButton";
import { FundingTable, HistoryTable } from "./ActivityTables";
import { PanelState } from "./PanelState";

type Tab = "history" | "funding";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "history", label: "Transactions" },
  { id: "funding", label: "Funding" },
];

/// PROJECT_BRIEF.md Section 22: the wallet's full record. Both tables come from the indexer, and
/// the Portfolio page shows the same ones next to the positions they belong to.
export function ActivityView() {
  const mode = useAccountMode();
  const [tab, setTab] = useState<Tab>("history");

  if (mode === "disconnected") {
    return (
      <Panel className="flex-1">
        <PanelState action={<ConnectButton />}>Connect a wallet to see its transactions and funding payments.</PanelState>
      </Panel>
    );
  }

  return (
    <Panel className="flex-1" title={<Tabs label="Activity sections" tabs={tabs} value={tab} onChange={setTab} />}>
      <div role="tabpanel" className="flex-1 overflow-x-auto">
        {tab === "history" ? <HistoryTable /> : <FundingTable />}
      </div>
    </Panel>
  );
}
