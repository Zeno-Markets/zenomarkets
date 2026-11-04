import { create } from "zustand";

/// What the landing page's copy and its 3D world tell each other. The canvas reads it with `getState()`
/// once a frame and writes only when a value changes; the copy subscribes with selectors.
interface LandingLinkState {
  /// Market ids in the group chosen on the Markets tabs; empty for "All". The globe turns to face them.
  region: readonly string[];
  /// Where the pointer sits across the screen while Trade is shown, 0 (left) to 1 (right); null with no
  /// pointer. The 3D price line and the payoff drawing both follow it.
  price: number | null;
  /// How far the Capital calculator's borrow sits toward liquidation, 0 to 1; the 3D gauge needle shows it.
  gauge: number;
  /// The contract (an index into `CONTRACTS`) hovered in the copy or on its 3D block; -1 for none.
  contract: number;
}

export const useLandingLink = create<LandingLinkState>(() => ({ region: [], price: null, gauge: 0.4, contract: -1 }));
