import { AppPage } from "@/components/AppPage";
import { StrategyBuilder } from "@/components/StrategyBuilder";
/// PROJECT_BRIEF.md Section 41: the options strategy builder. Same AppPage frame as Portfolio and Activity.
export default function Page() {
  return (
    <AppPage title="Strategies" description="Build an options strategy and see its payoff, cost and break-even before you trade.">
      <StrategyBuilder />
    </AppPage>
  );
}
