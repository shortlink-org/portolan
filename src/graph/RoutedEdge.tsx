// An edge that draws the route elk computed for it.
//
// React Flow's own edge types - bezier, smoothstep, straight - all take two
// endpoints and invent everything between them. That is fine on a graph laid
// out by hand and wrong on one laid out by elk: elk already decided where the
// line should go, around which boxes and through which gaps, and throwing that
// away to draw a curve between the same two points is how a line ends up
// crossing the node it was routed around.
//
// So the points come in through `data` and the path is drawn from them.

import { BaseEdge, EdgeLabelRenderer } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { useSelectionStore } from "../selection/store";
import { midpoint, roundedPath } from "./elk";
import type { Point } from "./elk";

export interface RoutedEdgeData {
  points: Point[];
  /** Text for the chip at the midpoint - a bundle's event count, and nothing else. */
  chip?: string;
  chipTitle?: string;
  /**
   * Where the chip goes. Chosen at layout time, where the boxes are known: the
   * middle of a route that loops around the graph is over the middle of the
   * graph, which is the one place a number must not be.
   */
  chipAt?: Point;
  /** What clicking the chip selects. The line itself is handled by the canvas. */
  selectId?: string;
  [key: string]: unknown;
}

export type RoutedEdgeType = Edge<RoutedEdgeData, "routed">;

export function RoutedEdge({
  id,
  data,
  style,
  markerEnd,
  interactionWidth,
}: EdgeProps<RoutedEdgeType>) {
  const points = data?.points ?? [];
  if (points.length < 2) return null;

  const path = roundedPath(points);
  const opacity = Number(style?.opacity ?? 1);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 14}
      />
      {data?.chip ? (
        <Chip at={data.chipAt ?? midpoint(points)} data={data} opacity={opacity} />
      ) : null}
    </>
  );
}

/**
 * The count on a bundled edge.
 *
 * It sits in the label layer, above the nodes, and it carries the canvas
 * background and a hairline of its own: a number printed straight onto a line
 * is a number with a line through it.
 */
function Chip({
  at,
  data,
  opacity,
}: {
  at: Point;
  data: RoutedEdgeData;
  opacity: number;
}) {
  const select = useSelectionStore((s) => s.select);
  return (
    <EdgeLabelRenderer>
      <button
        type="button"
        onClick={() => {
          if (data.selectId) select(data.selectId, "diagram");
        }}
        className="mono nodrag nopan tnum"
        title={data.chipTitle}
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${at.x}px, ${at.y}px)`,
          background: "var(--bg)",
          color: "var(--fg-muted)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "0 4px",
          fontSize: 10,
          lineHeight: "15px",
          whiteSpace: "nowrap",
          opacity,
          zIndex: 5,
          // The chip is the only thing on a bundled edge a reader can point
          // at, so it takes the pointer even though the line under it does too.
          pointerEvents: "all",
          cursor: "pointer",
        }}
      >
        {data.chip}
      </button>
    </EdgeLabelRenderer>
  );
}

export const dependencyEdgeTypes = { routed: RoutedEdge };
