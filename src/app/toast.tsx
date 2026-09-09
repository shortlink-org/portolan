// One line, bottom left, gone in four seconds.
//
// The app has exactly one thing to say this way: that a pin pushed another pin
// out. It is not an error and it is not a page, but it must not be silent
// either - a reader who watches their oldest pin vanish with no word learns
// that the pin list loses things at random.

import { useEffect } from "react";
import { create } from "zustand";
import { AnimatePresence, m, rise } from "../lib/motion";

interface ToastState {
  message: string | null;
  action: { label: string; run: () => void } | null;
  /** Bumped per call, so the same message twice restarts the timer. */
  nonce: number;
  say: (message: string, action?: { label: string; run: () => void }) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  action: null,
  nonce: 0,
  say: (message, action) => set((s) => ({ message, action: action ?? null, nonce: s.nonce + 1 })),
  clear: () => set({ message: null, action: null }),
}));

const SHOWN_MS = 4000;

export function Toaster() {
  const message = useToastStore((s) => s.message);
  const nonce = useToastStore((s) => s.nonce);
  const action = useToastStore((s) => s.action);
  const clear = useToastStore((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clear, action ? 10_000 : SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message, nonce, action, clear]);

  // It rises in and sinks out. A second message while one is up swaps the
  // text in place: the box is the same box, only its line changed.
  return (
    <AnimatePresence>
      {message && (
        <m.div
          {...rise}
          role="status"
          aria-live="polite"
          /* Bottom RIGHT, not left: the foot of the sidebar is where Problems
             and the build line are pinned, and a message that covers them for
             four seconds hides the one row that promised never to leave. */
          className="mono fixed right-4 bottom-4 z-50 flex max-w-96 items-center gap-3 rounded-control border px-3 py-2 shadow-md border-line bg-canvas text-ink"
        >
          <span>{message}</span>
          {action ? <button type="button" className="tbtn shrink-0 px-2 py-1 text-accent" onClick={() => { action.run(); clear(); }}>{action.label}</button> : null}
        </m.div>
      )}
    </AnimatePresence>
  );
}
