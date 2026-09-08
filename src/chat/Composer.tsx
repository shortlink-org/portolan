// The question box.
//
// One line that grows to six, the send button inside the field where the
// cursor already is, and stop in its place while an answer is coming. Enter
// sends; a new line is shift-enter, said once under the field.

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

const MAX_HEIGHT = 160;

export function Composer({
  busy,
  onSend,
  onStop,
  focusOnMount = true,
}: {
  busy: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
  focusOnMount?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);

  // Grow with the text, up to the limit; shrink back when it is deleted.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  const send = () => {
    const question = draft.trim();
    if (!question || busy) return;
    onSend(question);
    setDraft("");
  };

  const BUTTON =
    "absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-control transition-colors";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="border-t border-line px-3 pt-3 pb-2"
    >
      <div className="relative">
        <textarea
          ref={field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="ask about a service, a flow, a decision…"
          aria-label="Your question"
          className="block w-full resize-none rounded-card border border-line bg-canvas py-2.5 pr-11 pl-3 text-ink outline-none transition-colors focus:border-accent"
          style={{ maxHeight: MAX_HEIGHT }}
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop the answer"
            title="Stop"
            className={`${BUTTON} border border-line text-ink hover:border-line-strong`}
          >
            <Square size={12} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={draft.trim() === ""}
            aria-label="Ask"
            title="Ask — ⏎"
            className={`${BUTTON} bg-accent text-white hover:opacity-90 disabled:cursor-default disabled:opacity-30`}
          >
            <ArrowUp size={14} aria-hidden />
          </button>
        )}
      </div>
      <div className="mono mt-1.5 flex items-center gap-3 text-muted">
        <span>⏎ send</span>
        <span>⇧⏎ new line</span>
      </div>
    </form>
  );
}
