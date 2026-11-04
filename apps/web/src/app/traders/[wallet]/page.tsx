import { chip, cn } from "@zeno/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/AppPage";
import { TraderProfile } from "@/components/TraderProfile";
import { env } from "@/lib/env";
import { MONO } from "@/lib/frame";


type Props = { params: Promise<{ wallet: string }> };

/// A trader's profile, behind `NEXT_PUBLIC_FEATURE_COPY_TRADING`: their ranking figures and a way to copy them.
export default async function Page({ params }: Props) {
  const { wallet } = await params;
  if (!env.copyTrading || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) notFound();
  return (
    <AppPage
      title="Trader"
      description={<span className={cn(MONO, "break-all")}>{wallet}</span>}
      actions={
        <Link href="/leaderboard" className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
          Back to the leaderboard
        </Link>
      }
    >
      <TraderProfile wallet={wallet.toLowerCase()} />
    </AppPage>
  );
}
