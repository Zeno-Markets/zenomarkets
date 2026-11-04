import { Suspense } from "react";
import { AppPage } from "@/components/AppPage";
import { MarketsTable } from "@/components/MarketsTable";

export default function Page() {
  return (
    <AppPage title="Markets" description="Every listed market. Open a row to trade its perpetual, or go straight to its options.">
      <Suspense fallback={null}>
        <MarketsTable />
      </Suspense>
    </AppPage>
  );
}
