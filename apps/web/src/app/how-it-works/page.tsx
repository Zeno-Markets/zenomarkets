import type { Metadata } from "next";
import { AppPage } from "@/components/AppPage";
import { HowItWorks, HowStats } from "@/components/how/HowItWorks";
import { ProgressProvider } from "@/components/how/kit";

export const metadata: Metadata = {
  title: "How it works",
  description: "Learn every ZENO feature by playing with it: perpetuals, orders, options, strategies, lending, the leaderboard and copy trading, as interactive models.",
};

export default function Page() {
  return (
    <ProgressProvider>
      <AppPage title="How it works" description="Pick a chapter, watch the steps, then do them yourself." actions={<HowStats />}>
        <HowItWorks />
      </AppPage>
    </ProgressProvider>
  );
}
