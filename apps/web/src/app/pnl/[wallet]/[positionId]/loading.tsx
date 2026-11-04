import { Skeleton } from "@zeno/ui";

/// The card's shape while it loads, so the page does not jump when it arrives.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6 lg:p-10" aria-busy="true" aria-label="Loading the PNL card">
      <div className="rounded-feature border border-line bg-surface p-9">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 block h-6 w-48" />
        <Skeleton className="mt-6 block h-16 w-72" />
        <Skeleton className="mt-8 block h-10 w-full" />
      </div>
    </div>
  );
}
