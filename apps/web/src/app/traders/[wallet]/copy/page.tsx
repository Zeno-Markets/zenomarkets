import { Panel, chip, cn } from "@zeno/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPage } from "@/components/AppPage";
import { CopyFlow } from "@/components/CopyFlow";
import { env } from "@/lib/env";
import { MONO } from "@/lib/frame";


type Props = { params: Promise<{ wallet: string }> };

/// The copy flow, V3.0 (`env.copyTrading`).
export default async function Page({ params }: Props) {
  const { wallet } = await params;
  if (!env.copyTrading || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) notFound();
  return (
    <AppPage
      title="Copy a trader"
      description={<span className={cn(MONO, "break-all")}>{wallet}</span>}
      actions={
        <Link href={`/traders/${wallet}`} className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
          Back to the trader
        </Link>
      }
    >
      <Panel className="flex-1" title="Copy flow">
        <CopyFlow leader={wallet as `0x${string}`} />
      </Panel>
    </AppPage>
  );
}
