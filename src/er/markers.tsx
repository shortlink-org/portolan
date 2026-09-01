// Crow's-foot markers, defined once per canvas.
//
// The notation is the point: a foreign key is a MANY-to-one relationship, and
// an arrowhead says only "points at". The fan sits on the table holding the
// key, the bar on the table it points to, so the cardinality is readable
// without a legend.
//
// Both take their colour from the edge through `context-stroke`, so a
// highlighted edge highlights its ends with it rather than needing a second
// pair of markers.

export const MARKER_MANY = "er-many";
export const MARKER_ONE = "er-one";
/**
 * Lineage is not a cardinality, so it gets neither end of the crow's foot: a
 * plain arrow, pointing the way the data travels. A reader who has learned
 * that a fan means "many" is not asked to unlearn it here.
 */
export const MARKER_FLOW = "er-flow";

export function ErMarkers() {
  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <marker
          id={MARKER_MANY}
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          refX="0"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M0 1 L11 6 M0 6 L11 6 M0 11 L11 6"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1"
          />
        </marker>
        <marker
          id={MARKER_FLOW}
          viewBox="0 0 12 12"
          markerWidth="9"
          markerHeight="9"
          refX="9"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1 2 L9 6 L1 10 Z" fill="context-stroke" stroke="none" />
        </marker>
        <marker
          id={MARKER_ONE}
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          refX="12"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M7 2 L7 10"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.2"
          />
        </marker>
      </defs>
    </svg>
  );
}
