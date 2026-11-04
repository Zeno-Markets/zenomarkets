import { PnlCard } from "@zeno/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PnlShare } from "@/components/PnlShare";
import { cardPartsFromApi, cardProps } from "@/lib/pnlCard";
import { loadPnlCard } from "@/lib/pnlCardApi";

type Props = { params: Promise<{ wallet: string; positionId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { wallet, positionId } = await params;
  const result = await loadPnlCard(wallet, positionId);
  if (result.kind !== "ok") return {};
  const p = cardProps(cardPartsFromApi(result.card));
  const description = `${p.symbol} ${p.side} ${p.pnl} (${p.roi})`;
  return { description, openGraph: { description }, twitter: { card: "summary_large_image", description } };
}

function Notice({ title, children, retryHref }: { title: string; children: string; retryHref?: string }) {
  return (
    <div className="rounded-panel border border-line/70 bg-surface p-6">
      <h1 className="text-title font-normal">{title}</h1>
      <p className="mt-2 max-w-prose text-muted">{children}</p>
      <div className="mt-4 flex gap-2 text-sm">
        {retryHref ? (
          <a href={retryHref} className="font-medium text-accent-fg underline underline-offset-2">
            Try again
          </a>
        ) : null}
        <Link href="/leaderboard" className="font-medium text-accent-fg underline underline-offset-2">
          See the leaderboard
        </Link>
      </div>
    </div>
  );
}

/// A position's PNL card at a URL anyone can open and share. It renders for an open position (live mark), a
/// closed one and a liquidated one; a paused market keeps its card and says there is no live price.
export default async function PnlCardPage({ params }: Props) {
  const { wallet, positionId } = await params;
  const result = await loadPnlCard(wallet, positionId);

  return (
    <div className="mx-auto w-full max-w-2xl p-6 lg:p-10">
      {result.kind === "not-found" ? (
        <Notice title="This card is not available">There is no card here. The position may not exist, or its owner may have chosen to keep it private.</Notice>
      ) : result.kind === "unavailable" ? (
        <Notice title="The card could not be loaded" retryHref={`/pnl/${wallet}/${positionId}`}>
          The price service or the chain did not answer. Nothing is wrong with the position. Try again in a moment.
        </Notice>
      ) : (
        <div className="flex flex-col gap-5">
          <PnlCard {...cardProps(cardPartsFromApi(result.card))} mark={<Logo size="sm" />} />
          {result.card.status === "open" && result.card.markPrice === null ? (
            <p className="text-sm leading-snug text-muted">This market has no live price right now, because it is closed or paused. The card shows what the position has booked so far.</p>
          ) : null}
          <PnlShare path={`/pnl/${result.card.wallet}/${result.card.positionId}`} text={`${result.card.symbol} ${result.card.side}: ${cardProps(cardPartsFromApi(result.card)).pnl} on ZENO`} />
        </div>
      )}
    </div>
  );
}
