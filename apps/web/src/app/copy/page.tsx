import { Panel } from "@zeno/ui";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/AppPage";
import { CopyFollows } from "@/components/CopyFollows";
import { env } from "@/lib/env";


export default function Page() {
  if (!env.copyTrading) notFound();
  return (
    <AppPage title="Copy trading" description="The traders you copy, what was copied for you and what was skipped, with the reason. Stop at any time and withdraw what is left.">
      <Panel className="flex-1" title="Your copy accounts">
        <CopyFollows />
      </Panel>
    </AppPage>
  );
}
