import { AppPage } from "@/components/AppPage";
import { LeaderboardView } from "@/components/LeaderboardView";

export default function Page() {
  return (
    <AppPage title="Leaderboard" description="Traders ranked by PNL, ROI or volume. Rank is earned on the same rules for everyone.">
      <LeaderboardView />
    </AppPage>
  );
}
