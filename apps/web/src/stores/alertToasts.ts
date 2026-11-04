import { create } from "zustand";
import type { NotificationRow } from "@/lib/alerts";

/// Price alerts that fired while this page was open, waiting to be shown. The bell fills it from its poll.
interface AlertToastState {
  toasts: NotificationRow[];
  push: (items: NotificationRow[]) => void;
  dismiss: (id: number) => void;
}

export const useAlertToasts = create<AlertToastState>((set) => ({
  toasts: [],
  push: (items) => set((state) => ({ toasts: [...state.toasts, ...items.filter((item) => !state.toasts.some((t) => t.id === item.id))] })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
