import { Button, Panel } from "@zeno/ui";
import Link from "next/link";
import { AppPage } from "@/components/AppPage";
import { PanelState } from "@/components/PanelState";

/// Any address that is not a page: the same frame as every other page, with a way back.
export default function NotFound() {
  return (
    <AppPage title="Page not found" description="There is no page at this address. It may have moved, or the link may be mistyped.">
      <Panel className="flex-1" title="Where to next">
        <PanelState
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/markets" tabIndex={-1}>
                <Button variant="primary">Open markets</Button>
              </Link>
              <Link href="/" tabIndex={-1}>
                <Button>Go to the home page</Button>
              </Link>
            </div>
          }
        >
          Pick a market to trade, or start again from the home page.
        </PanelState>
      </Panel>
    </AppPage>
  );
}
