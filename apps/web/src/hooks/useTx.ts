"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { TxOptions } from "@zeno/sdk";
import { useTxStore } from "@/stores/tx";

const HISTORY_RETRY_SECONDS = [3, 6, 10, 15, 25, 40, 60];

/// Runs one SDK write and mirrors its Section 30 states into the confirmation panel. The SDK
/// already turns reverts into typed errors and emits every state, so this only wires them up.
export function useTx() {
  const start = useTxStore((state) => state.start);
  const update = useTxStore((state) => state.update);
  const patch = useTxStore((state) => state.patch);
  const queryClient = useQueryClient();

  return async function run<T>(
    meta: { title: string; summary?: string },
    action: (tx: TxOptions) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    const id = start(meta.title, meta.summary);
    try {
      const value = await action({ wait: true, onStatus: (event) => update(id, event) });
      if (typeof value === "object" && value !== null && "positionId" in value) {
        patch(id, { positionId: (value as { positionId: bigint }).positionId });
      }
      // A confirmed write changes balances, positions and prices.
      void queryClient.invalidateQueries();
      // The indexer lags the chain, so history is empty on the first refetch. Ask again until it catches up.
      for (const seconds of HISTORY_RETRY_SECONDS) {
        setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["history"] }), seconds * 1000);
      }
      return { ok: true, value };
    } catch {
      // The failure is already on the record via `onStatus`.
      return { ok: false };
    }
  };
}
