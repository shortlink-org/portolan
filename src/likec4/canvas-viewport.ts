// Where the canvas starts looking, and at what size.
//
// Fit-to-view is the wrong opening move for a flow. Fitting a forty-five step
// sequence into a pane puts every label at three or four pixels, which is a
// picture of a flow rather than a flow: the reader can see that it is long and
// nothing else. So the canvas opens at the size the labels were drawn for and
// shows the beginning, which is where reading starts anyway. Fit-to-view stays
// one button away, for the reader who wants the shape rather than the words.
//
// Pure arithmetic, kept out of the component so the one decision worth arguing
// about — what "the beginning" means when the diagram is narrower than the
// pane — is stated once and tested.

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** The authored size. Below roughly 0.7 the 16px labels stop being words. */
export const READABLE_ZOOM = 1;

/** Breathing room between the diagram and the edge of the pane. */
export const CANVAS_PAD = 24;

/**
 * The opening viewport: the top of the diagram, at readable zoom.
 *
 * Horizontally it centres when the diagram fits and left-aligns when it does
 * not. Centring a diagram that overflows would open the reader in the middle
 * of the first row with the start scrolled off to the left, and left-aligning
 * one that fits leaves a dead half-canvas on the right — so it is neither rule
 * everywhere, it is each rule where it is the true one.
 *
 * Vertically it always aligns to the top: the first step is the first step
 * whether or not the sequence fits, and centring a short flow would push it
 * down away from the participants header it belongs under.
 */
export function readableViewport(
  bounds: BBox,
  canvas: Size,
  zoom: number = READABLE_ZOOM,
): Viewport {
  const width = bounds.width * zoom;
  const fits = width + CANVAS_PAD * 2 <= canvas.width;
  const x = fits
    ? (canvas.width - width) / 2 - bounds.x * zoom
    : CANVAS_PAD - bounds.x * zoom;
  return {
    x: Math.round(x),
    y: Math.round(CANVAS_PAD - bounds.y * zoom),
    zoom,
  };
}

/** How far the canvas may zoom out to get one step wholly on screen. */
export const MIN_FOCUS_ZOOM = 0.2;

/** The box a polyline occupies, or null for a line with no points. */
export function boundsOf(
  points: readonly (readonly [number, number])[],
): BBox | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A viewport that shows one thing whole, as large as it will go.
 *
 * This exists because "bring step 12 into view" has to mean it. LikeC4's own
 * centring caps the zoom at what the viewport already had, which for a step
 * whose arrow is wider than the pane leaves the arrow half off the screen —
 * technically centred, not actually visible. So the zoom comes down as far as
 * it must and no further, and stops at MIN_FOCUS_ZOOM rather than diving to
 * whatever a pathological arrow would need.
 */
export function focusViewport(
  bounds: BBox,
  canvas: Size,
  max: number = READABLE_ZOOM,
): Viewport {
  const room = (span: number, size: number): number =>
    span > 0 ? (size - CANVAS_PAD * 2) / span : max;
  const zoom = Math.max(
    MIN_FOCUS_ZOOM,
    Math.min(max, room(bounds.width, canvas.width), room(bounds.height, canvas.height)),
  );
  return centredViewport(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    canvas,
    zoom,
  );
}

/**
 * Readable zoom, centred on one point of the diagram.
 *
 * For the variant that has no beginning. A diagram folds a flow's steps onto
 * the handful of boxes that repeat, so there is no top-left corner that means
 * "start here" — but there is still a first step, and its arrow is a place the
 * reader can be put down at a size where the labels are words.
 */
export function centredViewport(
  point: { x: number; y: number },
  canvas: Size,
  zoom: number = READABLE_ZOOM,
): Viewport {
  return {
    x: Math.round(canvas.width / 2 - point.x * zoom),
    y: Math.round(canvas.height / 2 - point.y * zoom),
    zoom,
  };
}
