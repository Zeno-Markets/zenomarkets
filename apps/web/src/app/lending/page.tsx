import { notFound } from "next/navigation";
import { AppPage } from "@/components/AppPage";
import { LendingView } from "@/components/LendingView";
import { env } from "@/lib/env";

/// Lending opens on mainnet with V2.0 (`@zeno/config` releases.ts).
export default function Page() {
  if (!env.lending) notFound();
  return (
    <AppPage title="Lending" description="Lock a stock token as collateral and borrow USDG against it. Your health factor says how safe the loan is.">
      <LendingView />
    </AppPage>
  );
}
