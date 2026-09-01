// The seam between two renderers, painted over.
//
// LikeC4 draws the alt/par/loop frames of a sequence in its own palette —
// saturated fills, one hue per keyword — which inside portolan reads as the
// loudest thing on the canvas. It is the wrong thing to be loudest. A frame
// says *under what condition*, and the arrows say *what happens*; the arrows
// already carry status colour, and a frame competing with them for the same
// glance costs the reader the one signal the picture is for.
//
// So the frames are turned down to the app's own surfaces. This is not a hack
// around a missing prop: `--colors-subflow-*` are the tokens LikeC4 publishes
// for exactly this, and every value below is a portolan token, so a theme swap
// carries the canvas with it.

/** Every subflow keyword LikeC4 paints, including the ones our generator emits. */
const KEYWORDS = ["alt", "par", "loop", "break", "opt", "try"] as const;

/** Frame fill: present enough to bound the branch, quiet enough to sit under it. */
const FILL = "color-mix(in srgb, var(--surface) 60%, transparent)";
/** The keyword badge and the header strip, one step up from the fill. */
const HEADER = "color-mix(in srgb, var(--surface-2) 70%, transparent)";

/**
 * The stylesheet, as a string, for the diagram's own root. Scoped to
 * `.react-flow` because that is the one class React Flow guarantees and the
 * custom properties inherit from it down to every frame inside.
 */
export function buildFrameCss(): string {
  const vars = KEYWORDS.flatMap((keyword) => [
    `--colors-subflow-${keyword}: ${FILL};`,
    `--colors-subflow-${keyword}-border: var(--border);`,
    `--colors-subflow-${keyword}-header: ${HEADER};`,
    `--colors-subflow-${keyword}-hovered: var(--surface-2);`,
    `--colors-subflow-${keyword}-label: var(--border-strong);`,
    `--colors-subflow-${keyword}-text: var(--fg-muted);`,
  ]);
  // The walkthrough paints parallel frames from a token of its own, and a
  // parallel that changes colour the moment playback starts reads as a
  // different frame rather than the same one being visited.
  vars.push("--colors-likec4-walkthrough-parallel-frame: " + FILL + ";");
  return `.react-flow {\n  ${vars.join("\n  ")}\n}`;
}

/**
 * LikeC4's own sequence outline, hidden.
 *
 * Starting a walkthrough opens a panel down the left of the canvas listing the
 * steps and marking the active one — which is, to the pixel, what the rail
 * beside the canvas already is. Two outlines is one too many, and this is the
 * one lying on top of the picture.
 *
 * There is no prop for it, so it goes by selector. The class names are Panda's
 * atomic ones, which are derived from the declarations rather than hand-named,
 * so a LikeC4 upgrade that restyles the panel will bring it back — visibly, as
 * a panel that reappeared, rather than silently as something broken. The
 * combination is narrow enough that nothing else in the canvas matches it: a
 * full-height box pinned to the top-left corner of the diagram root.
 *
 * Its width is not reclaimed. LikeC4 frames each walkthrough step inside the
 * canvas MINUS this panel, so hiding it leaves that band empty rather than
 * giving it to the diagram — the same space the panel would have taken, just
 * not covering anything.
 */
export function buildWalkthroughCss(): string {
  return [
    ".likec4-root > .pos_absolute.top_0.left_0.h_100cqh {",
    "  display: none;",
    "}",
  ].join("\n");
}

/**
 * Frames the chosen path does not run through, dimmed rather than hidden.
 *
 * Hiding them would redraw the picture every time the branch selector moved,
 * and the shape of a flow — that there IS a choice here, with three arms — is
 * most of what the canvas is for. So the branch not taken stays exactly where
 * it was and recedes, which is the same thing the rail does to its rows.
 */
export function buildOffPathCss(frameIds: readonly string[]): string {
  if (frameIds.length === 0) return "";
  const selector = frameIds
    .map((id) => `.react-flow__node[data-id="${cssQuote(id)}"]`)
    .join(",\n");
  return `${selector} {\n  opacity: 0.35;\n  transition: opacity 120ms ease;\n}`;
}

/** CSS string escape for an attribute value. */
function cssQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
