import { create } from "zustand";
import { ZenoContractError, UserRejectedError, type TxEvent, type TxStatus } from "@zeno/sdk";
import { revertReason } from "@/lib/revertReasons";

/// One row per user action (approve, deposit, open position, close position). The store holds
/// what the Section 30 confirmation panel needs: the current state, the hash once there is one,
/// and a plain-language summary of what was submitted.
export interface TxRecord {
  id: string;
  title: string;
  /// Shown once confirmed, e.g. "NVDA-PERP · Long · $5,000 · 5x".
  summary?: string;
  status: TxStatus;
  hash?: `0x${string}`;
  blockNumber?: bigint;
  error?: string;
  /// The person declined the wallet prompt. That is a choice, not a failure: shown calmly, nothing to fix.
  rejected?: boolean;
  positionId?: bigint;
}

interface TxState {
  records: TxRecord[];
  start: (title: string, summary?: string) => string;
  update: (id: string, event: TxEvent) => void;
  patch: (id: string, patch: Partial<TxRecord>) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useTxStore = create<TxState>((set) => ({
  records: [],
  start: (title, summary) => {
    const id = `tx-${Date.now()}-${counter++}`;
    const record: TxRecord = { id, title, summary, status: "preparing" };
    set((state) => ({ records: [record, ...state.records].slice(0, 5) }));
    return id;
  },
  update: (id, event) =>
    set((state) => ({
      records: state.records.map((record) =>
        record.id === id
          ? {
              ...record,
              status: event.status,
              hash: event.hash ?? record.hash,
              blockNumber: event.receipt?.blockNumber ?? record.blockNumber,
              error: event.error ? errorMessage(event.error) : record.error,
              rejected: event.error ? event.error instanceof UserRejectedError : record.rejected,
            }
          : record,
      ),
    })),
  patch: (id, patch) => set((state) => ({ records: state.records.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  dismiss: (id) => set((state) => ({ records: state.records.filter((record) => record.id !== id) })),
}));

/// What a person needs to read: what went wrong and what to do next, without stack traces, hex or a
/// wallet's own wording. A contract revert is looked up by its error name; anything else is generic.
/// Uses `instanceof`, not class names, because production builds minify class names.
export function errorMessage(error: unknown): string {
  if (error instanceof UserRejectedError) return "You declined the request in your wallet. Nothing was sent.";
  if (error instanceof ZenoContractError) return revertReason(error.errorName);
  return "The transaction did not go through. Nothing was lost. Try again, and tell us if it keeps happening.";
}
