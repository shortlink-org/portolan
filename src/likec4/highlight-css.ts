// Marking the selection on a LikeC4 canvas is a paint job, nothing more.
//
// The diagram is laid out ahead of time and rendered inside a shadow root, so
// the one safe way to mark something in it is a stylesheet placed inside that
// root, keyed on the `data-id` React Flow already puts on every node and edge.
// No prop the layout depends on is touched, which is what keeps a selection
// from nudging the picture.

const NODE = ".react-flow__node";
const EDGE = ".react-flow__edge";

/** CSS string escape for an attribute value. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** `:not()` chained rather than given a list, for older WebKit. */
function excluding(base: string, ids: readonly string[]): string {
  return base + ids.map((id) => `:not([data-id="${q(id)}"])`).join("");
}

function matching(base: string, ids: readonly string[]): string {
  return ids.map((id) => `${base}[data-id="${q(id)}"]`).join(", ");
}

/**
 * Dims everything that is not selected and outlines what is. Dimming is done
 * per category: highlighting a step must not grey out the lanes it runs
 * between, and highlighting a service must not grey out the arrows into it.
 */
export function buildHighlightCss(
  nodeIds: readonly string[],
  edgeIds: readonly string[],
): string {
  const rules: string[] = [];

  if (nodeIds.length > 0) {
    rules.push(
      `${excluding(NODE, nodeIds)} { opacity: 0.3; transition: opacity 120ms ease; }`,
      `${matching(NODE, nodeIds)} { outline: 2px solid var(--accent); outline-offset: 3px; }`,
    );
  }

  if (edgeIds.length > 0) {
    rules.push(
      `${excluding(EDGE, edgeIds)} { opacity: 0.18; transition: opacity 120ms ease; }`,
      `${matching(EDGE, edgeIds)} { opacity: 1; }`,
    );
  }

  return rules.join("\n");
}
