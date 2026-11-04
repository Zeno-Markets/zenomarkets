import { chip, cn } from "@zeno/ui";
import Link from "next/link";

/// An empty list inside a panel: one sentence and, where there is one, the next step as a link.
export function EmptyRow({ children, action }: { children: string; action?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3">
      <p className="text-muted">{children}</p>
      {action ? (
        <Link href={action.href} className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
