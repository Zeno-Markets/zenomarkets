import type { ReactNode } from "react";
import { APP_GUTTER } from "@/lib/frame";
import { Footer } from "./Footer";
import { PageHeader } from "./PageHeader";

/// The one layout of every page that is not a terminal (docs/UI_CONTRACT.md Section 3, Layout). It is
/// full width with the shared gutter, it is at least as tall as the scroll area, and its body grows to
/// fill the space under the title, so a panel runs to the bottom of the screen instead of ending in
/// the middle of it. The footer pins to the bottom. Cap the width of prose inside the page, never the
/// page itself.
export function AppPage({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full w-full flex-col">
      <div className={`mx-auto flex w-full max-w-[1920px] flex-1 flex-col py-4 lg:py-6 ${APP_GUTTER}`}>
        <PageHeader title={title} actions={actions}>
          {description}
        </PageHeader>
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
