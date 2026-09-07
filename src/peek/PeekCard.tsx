// The card itself: one glance at a thing, drawn next to where the pointer is.
//
// It is the detail panel's first screen at a third of the width, and it says
// nothing the panel would not: the same icon, the same kind, the same names.
// A card that used a vocabulary of its own would be one more thing to learn
// on the way to the thing it describes.
//
// It opens below the anchor and flips above it when the bottom of the window
// is closer than the card is tall. Left is the anchor's left, held inside the
// window; the card never covers what was hovered, because the pointer is
// still there and the reader is about to click it.

import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { KindIcon } from "../components/kind";
import { ctxStyle } from "../lib/context-color";
import { KIND_LABEL } from "../lib/kinds";
import { m, scaleIn } from "../lib/motion";
import type { Peek } from "./model";

/** Wide enough for two lines of prose, narrow enough not to be a panel. */
export const CARD_WIDTH = 300;
/** Air between the anchor and the card, and between the card and the window. */
const GAP = 6;
const MARGIN = 8;

/**
 * Where to put a card of `height` for an anchor at `rect`, in viewport
 * coordinates. Exported for the test: the flip and the clamp are the whole
 * of what can go wrong with a floating box.
 */
export function placeCard(
  rect: Pick<DOMRect, "left" | "top" | "bottom">,
  height: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(
    MARGIN,
    Math.min(rect.left, viewport.width - CARD_WIDTH - MARGIN),
  );
  const below = rect.bottom + GAP;
  const fitsBelow = below + height <= viewport.height - MARGIN;
  const above = rect.top - GAP - height;
  const top = fitsBelow || above < MARGIN ? below : above;
  return { left, top: Math.max(MARGIN, top) };
}

export function PeekCard({ peek, rect }: { peek: Peek; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Placed below first, then measured and moved before paint when it does not
  // fit: useLayoutEffect runs ahead of the frame, so nothing flashes.
  const [at, setAt] = useState(() =>
    placeCard(rect, 0, { width: window.innerWidth, height: window.innerHeight }),
  );

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setAt(
      placeCard(rect, height, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [rect, peek]);

  const clamp: CSSProperties = {
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };

  return (
    <m.div
      ref={ref}
      {...scaleIn}
      data-peek-card
      role="tooltip"
      className="fixed z-40 rounded-control border p-3 shadow-md border-line bg-canvas text-ink"
      style={{ left: at.left, top: at.top, width: CARD_WIDTH }}
    >
      <div className="flex items-center gap-2">
        <span className="flex shrink-0" style={ctxStyle(peek.contextId)}>
          <KindIcon kind={peek.kind} contextId={peek.contextId ?? undefined} />
        </span>
        <span className="mono min-w-0 flex-1 truncate text-sm font-medium">
          {peek.name}
        </span>
        <span className="chip shrink-0">{KIND_LABEL[peek.kind]}</span>
      </div>
      <div className="mono mt-0.5 truncate t-micro text-muted" title={peek.where}>
        {peek.where}
      </div>
      {peek.blurb ? (
        <p className="mt-2 text-xs" style={clamp}>
          {peek.blurb}
        </p>
      ) : null}
      {peek.facts.length > 0 ? (
        <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 t-micro text-muted">
          {peek.facts.map((f) =>
            f.countable ? (
              <span key={f.label}>
                <span className="tnum font-medium text-ink">{f.value}</span>{" "}
                {f.label}
              </span>
            ) : (
              <span key={f.label}>
                {f.label}{" "}
                <span className="font-medium text-ink">{f.value}</span>
              </span>
            ),
          )}
        </div>
      ) : null}
    </m.div>
  );
}
