// Shell state of the chat: open or not, and what the panel is waiting on.
//
// Kept apart from the panel because the top bar opens it and the transport
// reports into it, and neither should have to import the panel - which is
// loaded lazily and carries the SDK.

import { create } from "zustand";

/** What the reader is waiting for, when it is not the model's own words. */
export type Phase = "index" | null;

interface ChatUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** "index" while the browser fetches llms.txt before the first question. */
  phase: Phase;
  setPhase: (phase: Phase) => void;
  /** When the current question was sent, for the "took 31s" line. */
  askedAt: number | null;
  setAskedAt: (at: number | null) => void;
  /** Seconds each answer took, by message id. */
  took: Record<string, number>;
  noteTook: (id: string, seconds: number) => void;
}

export const useChatUi = create<ChatUiState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  phase: null,
  setPhase: (phase) => set({ phase }),
  askedAt: null,
  setAskedAt: (askedAt) => set({ askedAt }),
  took: {},
  noteTook: (id, seconds) => set((s) => ({ took: { ...s.took, [id]: seconds } })),
}));
