// The pill that sits on a line.
//
// A word printed straight onto a line is a word with a line through it, so
// the label carries a surface of its own - the card colour and the card's
// ring - and lives in React Flow's label layer, which is above the nodes: on
// a short line between two neighbours the pill is wider than the gap, and a
// pill laid over a corner beats half a pill. The bundled edges of the
// dependency graph and the relation labels of the context map both draw this
// one; they used to draw two copies of it.

import { EdgeLabelRenderer } from "@xyflow/react";
import type { CSSProperties, ReactNode } from "react";
import type { Point } from "./elk";

export function EdgeLabel({
  at,
  opacity,
  title,
  onClick,
  children,
}: {
  at: Point;
  /** Follows the line's own opacity, so a dimmed line cannot have a lit label. */
  opacity: number;
  title?: string | undefined;
  /** When given the pill is a button and takes the pointer; otherwise it lets clicks through to the line. */
  onClick?: (() => void) | undefined;
  children: ReactNode;
}) {
  const style: CSSProperties = {
    position: "absolute",
    transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
    background: "var(--flow-card)",
    color: "var(--fg-muted)",
    boxShadow: "var(--shadow-card)",
    borderRadius: 999,
    padding: "0 6px",
    fontSize: 10,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    opacity,
    zIndex: 5,
    pointerEvents: onClick ? "all" : "none",
    cursor: onClick ? "pointer" : undefined,
  };
  const className = "mono nodrag nopan tnum";

  return (
    <EdgeLabelRenderer>
      {onClick ? (
        <button type="button" onClick={onClick} className={className} title={title} style={style}>
          {children}
        </button>
      ) : (
        <div className={className} title={title} style={style}>
          {children}
        </div>
      )}
    </EdgeLabelRenderer>
  );
}
