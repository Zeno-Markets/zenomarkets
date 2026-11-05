import { Suspense } from "react";
import { Footer } from "@/components/Footer";
import { NewsView } from "@/components/NewsView";
import { LANDING_FRAME, SPACED_CAPS } from "@/lib/frame";

/// A dedicated public page: it is linked from the landing page header, not from the app navigation, so it wears the
/// landing frame and header rather than `AppPage`.
export default function Page() {
  return (
    <div className="zeno-grid flex min-h-full w-full flex-col">
      <div className={`${LANDING_FRAME} flex flex-1 flex-col py-8 lg:py-12`}>
        <p className={`${SPACED_CAPS} text-muted`}>Market news</p>
        <h1 className="mt-3 font-condensed text-[3.25rem] font-bold uppercase leading-[0.92] sm:text-[5rem]">What is moving the markets</h1>
        <p className="mt-3 max-w-prose text-muted">Headlines for US stocks, China, crypto, ETFs and commodities. A badge on a story means Zeno lists that market: press it to open its perpetual.</p>
        <Suspense>
          <NewsView />
        </Suspense>
      </div>
      <Footer />
    </div>
  );
}
