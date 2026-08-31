// What a row offers once the pointer is on it.
//
// Two actions, and both answer a question a table cannot: "give me that id" and
// "where does this sit?". They are hidden at rest because a list of forty rows
// with eighty buttons in it is a list nobody can read, and they are in the DOM
// rather than conditionally rendered so keyboard focus can still reach them.

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ListTree } from "lucide-react";
import { toClipboard } from "../lib/clipboard";
import { useUiStore } from "../app/ui-store";
import { useSelectionStore } from "../selection/store";

const SHOWN_MS = 1000;

export function RowActions({
  copy,
  reveal,
  label,
}: {
  /** The string the copy button puts on the clipboard. */
  copy: string;
  /**
   * A catalog id the sidebar tree draws a row for - a context, a service, an
   * aggregate or an event. Omitted for anything the tree has no row for.
   */
  reveal?: string;
  /** What the buttons say they are acting on, for the accessible names. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const select = useSelectionStore((s) => s.select);
  const requestReveal = useUiStore((s) => s.requestReveal);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const what = label ?? copy;

  const onCopy = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void toClipboard(copy).then((ok) => {
        setCopied(ok);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), SHOWN_MS);
      });
    },
    [copy],
  );

  const onReveal = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!reveal) return;
      // The tree opens its own ancestors and scrolls itself once the selection
      // lands; all this has to do is make sure there is a tree to scroll.
      select(reveal, "page");
      requestReveal();
    },
    [reveal, select, requestReveal],
  );

  return (
    <span className="row-actions ml-auto shrink-0">
      <button
        type="button"
        onClick={onCopy}
        className="row-action"
        aria-label={`Copy ${what}`}
        title={`Copy ${what}`}
      >
        <Copy size={12} aria-hidden />
        {copied ? "copied" : "copy"}
      </button>
      {reveal ? (
        <button
          type="button"
          onClick={onReveal}
          className="row-action"
          aria-label={`Reveal ${what} in the catalog tree`}
          title="Reveal in tree"
        >
          <ListTree size={12} aria-hidden />
          reveal
        </button>
      ) : null}
    </span>
  );
}
