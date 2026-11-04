import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/// How the order tickets are laid out (docs/UI_CONTRACT.md Section 7). Guided, the default, ends every order
/// on a review step with Back and Confirm. Pro keeps the dense one-shot panel, with the same review figures
/// shown above its button. Neither reaches a signature without them.
export type TicketMode = "guided" | "pro";

interface ModeState {
  /// The connect explainer has been read once; later connects go straight to the wallet.
  explainerSeen: boolean;
  ticket: TicketMode;
  /// False until the persisted choice has been read, so the server render and the first client
  /// render agree (both show the default) and a stored choice applies a moment later.
  ready: boolean;
  markExplainerSeen: () => void;
  setTicket: (ticket: TicketMode) => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      explainerSeen: false,
      ticket: "guided",
      ready: false,
      markExplainerSeen: () => set({ explainerSeen: true }),
      setTicket: (ticket) => set({ ticket }),
    }),
    {
      name: "zeno-mode-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ explainerSeen: state.explainerSeen, ticket: state.ticket }),
      skipHydration: true,
      onRehydrateStorage: () => () => useModeStore.setState({ ready: true }),
    },
  ),
);
