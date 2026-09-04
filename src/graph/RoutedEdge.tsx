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

import { BaseEdge } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { useSelectionStore } from "../selection/store";
import { EdgeLabel } from "./EdgeLabel";
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
  const select = useSelectionStore((s) => s.select);
  const points = data?.points ?? [];
  if (points.length < 2) return null;

  const path = roundedPath(points);
  const opacity = Number(style?.opacity ?? 1);
  const selectId = data?.selectId;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 14}
      />
      {/* The count on a bundled edge. It is the only thing on the line a
          reader can point at, so it takes the pointer even though the line
          under it does too. */}
      {data?.chip ? (
        <EdgeLabel
          at={data.chipAt ?? midpoint(points)}
          opacity={opacity}
          title={data.chipTitle}
          onClick={() => {
            if (selectId) select(selectId, "diagram");
          }}
        >
          {data.chip}
        </EdgeLabel>
      ) : null}
    </>
  );
}

export const dependencyEdgeTypes = { routed: RoutedEdge };
