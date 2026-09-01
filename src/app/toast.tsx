// One line, bottom left, gone in four seconds.
//
// The app has exactly one thing to say this way: that a pin pushed another pin
// out. It is not an error and it is not a page, but it must not be silent
// either - a reader who watches their oldest pin vanish with no word learns
// that the pin list loses things at random.

import { useEffect } from "react";
import { create } from "zustand";

interface ToastState {
  message: string | null;
  /** Bumped per call, so the same message twice restarts the timer. */
  nonce: number;
  say: (message: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  nonce: 0,
  say: (message) => set((s) => ({ message, nonce: s.nonce + 1 })),
  clear: () => set({ message: null }),
}));

const SHOWN_MS = 4000;

export function Toaster() {
  const message = useToastStore((s) => s.message);
  const nonce = useToastStore((s) => s.nonce);
  const clear = useToastStore((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clear, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [message, nonce, clear]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      /* Bottom RIGHT, not left: the foot of the sidebar is where Problems and
         the build line are pinned, and a message that covers them for four
         seconds hides the one row that promised never to leave. */
      className="overlay-in mono pointer-events-none fixed right-4 bottom-4 z-50 max-w-80 rounded-control border px-3 py-2 shadow-md border-line bg-canvas text-ink"
    >
      {message}
    </div>
  );
}
