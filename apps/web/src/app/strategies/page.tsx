import { notFound } from "next/navigation";
import { AppPage } from "@/components/AppPage";
import { StrategyBuilder } from "@/components/StrategyBuilder";
import { env } from "@/lib/env";
/// PROJECT_BRIEF.md Section 41: the options strategy builder. Same AppPage frame as Portfolio and Activity. Opens on
/// mainnet with V2.0 (`@zeno/config` releases.ts).
export default function Page() {
  if (!env.strategies) notFound();
  return (
    <AppPage title="Strategies" description="Build an options strategy and see its payoff, cost and break-even before you trade.">
      <StrategyBuilder />
    </AppPage>
  );
}
