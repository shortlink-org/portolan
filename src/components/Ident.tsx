// Every identifier in the app, in one component.
//
// An id in a catalog browser exists to be pasted somewhere else - into a grep,
// a proto file, a ticket. Selecting 40 characters of monospace with a mouse is
// the worst way to do that, so every id, path and type name is a button that
// copies itself, and says so for a second afterwards.
//
// Written once and used everywhere on purpose: an id that copies on one page
// and merely sits there on the next teaches the reader not to try.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { toClipboard } from "../lib/clipboard";

/** How long "copied" stays up. One second: long enough to read, short enough. */
const SHOWN_MS = 1000;

export function Ident({
  value,
  children,
  className = "",
  style,
  title,
  mono = true,
  block = false,
}: {
  /** What lands on the clipboard. */
  value: string;
  /** What is shown, when that differs from what is copied. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Off for the rare identifier already inside a mono container. */
  mono?: boolean;
  /**
   * Takes a line of its own. The wrapper has to carry this, not the button:
   * the tooltip is positioned against the wrapper, so the wrapper is what
   * decides whether the id sits in the text flow or on its own row.
   */
  block?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    (e: React.MouseEvent) => {
      // Ids live inside rows that are themselves links often enough that this
      // has to say "the click was for me" every time.
      e.preventDefault();
      e.stopPropagation();
      void toClipboard(value).then((ok) => {
        setState(ok ? "copied" : "failed");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState("idle"), SHOWN_MS);
      });
    },
    [value],
  );

  return (
    <span
      className={`relative max-w-full align-baseline ${block ? "flex" : "inline-flex"}`}
    >
      <button
        type="button"
        onClick={copy}
        title={title ?? `${value} — click to copy`}
        aria-label={`Copy ${value}`}
        className={`ident ${mono ? "mono" : ""} ${className}`}
        style={style}
      >
        {children ?? value}
      </button>
      {state !== "idle" ? (
        <span role="status" className="ident-tip overlay-in">
          {state === "copied" ? "copied" : "copy failed"}
        </span>
      ) : null}
    </span>
  );
}
