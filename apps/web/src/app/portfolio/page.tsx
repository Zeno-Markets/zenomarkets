import { AppPage } from "@/components/AppPage";
import { PortfolioView } from "@/components/PortfolioView";

export default function Page() {
  return (
    <AppPage title="Portfolio" description="Your collateral, open positions and orders.">
      <PortfolioView />
    </AppPage>
  );
}
