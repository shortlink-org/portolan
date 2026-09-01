// Shell state that more than one place has to agree about.
//
// Two flags, and both exist because a keystroke fired at the window has to
// reach a panel rendered several routes deep. `detailHidden` is the reader
// saying "not now" to the detail rail without giving up their selection;
// `drawer` is the catalog tree, below the narrow breakpoint, where it is an
// overlay rather than a pane.

import { create } from "zustand";
import { readZebra, writeZebra } from "../table/persist";

interface UiState {
  /** True while "]" has folded the detail rail away. Selection is untouched. */
  detailHidden: boolean;
  toggleDetail: () => void;
  setDetailHidden: (hidden: boolean) => void;
  /** Narrow layouts only: the catalog tree, open over the page. */
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  toggleDrawer: () => void;
  /**
   * Bumped by "reveal in tree". The tree follows the selection on its own; what
   * it cannot do is give itself back the width it was collapsed out of, so the
   * shell watches this counter and opens the pane - or the drawer - around it.
   */
  revealNonce: number;
  requestReveal: () => void;
  /**
   * Zebra striping, for every table at once. It is a statement about how the
   * reader wants rows separated, not about the table they happen to be
   * looking at, so it is one flag and it outlives the session.
   */
  zebra: boolean;
  toggleZebra: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  detailHidden: false,
  toggleDetail: () => set((s) => ({ detailHidden: !s.detailHidden })),
  setDetailHidden: (hidden) => set({ detailHidden: hidden }),
  drawer: false,
  setDrawer: (open) => set({ drawer: open }),
  toggleDrawer: () => set((s) => ({ drawer: !s.drawer })),
  revealNonce: 0,
  requestReveal: () => set((s) => ({ revealNonce: s.revealNonce + 1 })),
  zebra: readZebra(),
  toggleZebra: () =>
    set((s) => {
      writeZebra(!s.zebra);
      return { zebra: !s.zebra };
    }),
}));
