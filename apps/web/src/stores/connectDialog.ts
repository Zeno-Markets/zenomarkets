import { create } from "zustand";

/// Whether the connect explainer is on screen. One dialog for the whole app, opened from any
/// "Connect wallet" button at the moment the person chooses to connect.
interface ConnectDialogState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useConnectDialog = create<ConnectDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
