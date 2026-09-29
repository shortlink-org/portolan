// A drawing given the whole screen.
//
// The button does not take the element it enlarges as a prop: it walks up to
// the nearest box marked `data-fullscreen`, the same way the export segment
// walks up to its canvas, so it sits in any toolbar that floats over or sits
// on top of a drawing without the page threading a ref down to it. A toolbar
// that lives outside its drawing names the box with `target` instead.

import { useEffect, useRef, useState } from "react";
import { Expand, Shrink } from "lucide-react";

export function FullscreenButton({
  target,
  onChange,
  className,
  size = 13,
  label = false,
}: {
  /** A selector for the box to enlarge; the nearest `[data-fullscreen]` otherwise. */
  target?: string;
  /** Called after the box has entered or left the screen, to refit the drawing. */
  onChange?: (on: boolean) => void;
  className?: string;
  size?: number;
  /** Show the word next to the icon, for a toolbar whose buttons all have one. */
  label?: boolean;
}) {
  const self = useRef<HTMLButtonElement | null>(null);
  const [on, setOn] = useState(false);
  const was = useRef(false);
  const changed = useRef(onChange);
  changed.current = onChange;

  const box = (): Element | null =>
    target
      ? document.querySelector(target)
      : (self.current?.closest("[data-fullscreen]") ?? null);

  useEffect(() => {
    const listen = (): void => {
      const now = document.fullscreenElement !== null && document.fullscreenElement === box();
      // Only the drawing that went in or came out refits; a second canvas on
      // the page hears the same event and has nothing to do with it.
      if (now === was.current) return;
      was.current = now;
      setOn(now);
      // The new size lands a frame after the event: refit once it has.
      requestAnimationFrame(() => requestAnimationFrame(() => changed.current?.(now)));
    };
    document.addEventListener("fullscreenchange", listen);
    return () => document.removeEventListener("fullscreenchange", listen);
    // `box` reads the DOM at event time; the selector is the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (typeof document !== "undefined" && !document.fullscreenEnabled) return null;

  const toggle = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void box()?.requestFullscreen();
  };

  const Icon = on ? Shrink : Expand;
  const title = on ? "Leave full screen (Esc)" : "Full screen";
  return (
    <button
      ref={self}
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title={title}
      aria-label={title}
      className={className ?? (label ? "flex items-center gap-1.5" : undefined)}
    >
      <Icon size={size} aria-hidden />
      {label ? (on ? "exit" : "full screen") : null}
    </button>
  );
}
