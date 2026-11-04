import { ActivityView } from "@/components/ActivityView";
import { AppPage } from "@/components/AppPage";

export default function Page() {
  return (
    <AppPage title="Activity" description="Every transaction and funding payment for the connected wallet.">
      <ActivityView />
    </AppPage>
  );
}
