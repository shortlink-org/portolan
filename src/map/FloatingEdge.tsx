// An edge that leaves a box from whichever side the other box is on.
//
// Every other diagram in this app is laid out left to right, so a line that
// always leaves the right edge and arrives at the left one is telling the
// truth. The context map is not laid out left to right - it is a map, spread
// in two dimensions - and there a fixed pair of sides makes a line to the box
// directly above loop all the way around it before coming back.
//
// So the endpoints are computed: the line runs between the two centres, and is
// cut where it crosses each box. The label is the same pill the dependency
// graph's bundled edges wear, and it says there why it lives above the nodes.

import { BaseEdge, useInternalNode } from "@xyflow/react";
import type { EdgeProps, InternalNode, Node } from "@xyflow/react";
import { EdgeLabel } from "../graph/EdgeLabel";

interface Point {
  x: number;
  y: number;
}

/**
 * Where the line from `from`'s centre to `to`'s centre crosses `from`'s box.
 *
 * The diamond form: a box is scaled to a unit square, the direction is taken
 * in that space, and the point is scaled back. It is React Flow's own recipe
 * for floating edges, and it is exact for a rectangle.
 */
function intersect(from: InternalNode<Node>, to: InternalNode<Node>): Point {
  const w = (from.measured.width ?? 0) / 2;
  const h = (from.measured.height ?? 0) / 2;
  if (w === 0 || h === 0) return from.internals.positionAbsolute;

  const cx = from.internals.positionAbsolute.x + w;
  const cy = from.internals.positionAbsolute.y + h;
  const tx = to.internals.positionAbsolute.x + (to.measured.width ?? 0) / 2;
  const ty = to.internals.positionAbsolute.y + (to.measured.height ?? 0) / 2;

  const u = (tx - cx) / (2 * w) - (ty - cy) / (2 * h);
  const v = (tx - cx) / (2 * w) + (ty - cy) / (2 * h);
  const scale = 1 / (Math.abs(u) + Math.abs(v) || 1);
  const su = scale * u;
  const sv = scale * v;

  return { x: w * (su + sv) + cx, y: h * (sv - su) + cy };
}

export function FloatingEdge({
  id,
  source,
  target,
  markerEnd,
  markerStart,
  style,
  label,
}: EdgeProps) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to) return null;

  const a = intersect(from, to);
  const b = intersect(to, from);
  const opacity = Number(style?.opacity ?? 1);

  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${a.x},${a.y} L ${b.x},${b.y}`}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
      />
      {label ? (
        <EdgeLabel
          at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }}
          opacity={opacity}
        >
          {label}
        </EdgeLabel>
      ) : null}
    </>
  );
}

export const mapEdgeTypes = { floating: FloatingEdge };
