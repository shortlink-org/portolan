import { describe, expect, it } from "vitest";
import {
  CANVAS_PAD,
  MIN_FOCUS_ZOOM,
  READABLE_ZOOM,
  boundsOf,
  centredViewport,
  focusViewport,
  readableViewport,
} from "./canvas-viewport";

/** Where a point of the diagram lands on screen under a viewport. */
const project = (
  value: number,
  offset: number,
  zoom: number,
): number => value * zoom + offset;

describe("readableViewport", () => {
  const canvas = { width: 1000, height: 700 };

  it("opens at the authored size rather than at whatever fits", () => {
    const huge = { x: 0, y: 0, width: 4000, height: 9000 };
    expect(readableViewport(huge, canvas).zoom).toBe(READABLE_ZOOM);
  });

  it("puts the top of the diagram at the top of the canvas", () => {
    const bounds = { x: 120, y: 60, width: 400, height: 3000 };
    const viewport = readableViewport(bounds, canvas);
    expect(project(bounds.y, viewport.y, viewport.zoom)).toBe(CANVAS_PAD);
  });

  it("centres a diagram narrower than the canvas", () => {
    const bounds = { x: 40, y: 0, width: 400, height: 300 };
    const viewport = readableViewport(bounds, canvas);
    const left = project(bounds.x, viewport.x, viewport.zoom);
    const right = project(bounds.x + bounds.width, viewport.x, viewport.zoom);
    expect(left).toBeCloseTo(canvas.width - right, 0);
  });

  it("left-aligns a diagram wider than the canvas, so step one is on screen", () => {
    const bounds = { x: 40, y: 0, width: 3000, height: 300 };
    const viewport = readableViewport(bounds, canvas);
    expect(project(bounds.x, viewport.x, viewport.zoom)).toBe(CANVAS_PAD);
  });

  it("does not centre a diagram that only just overflows", () => {
    // Exactly canvas-wide still needs its padding, so it counts as overflow
    // rather than as a fit with no room to breathe.
    const bounds = { x: 0, y: 0, width: canvas.width, height: 300 };
    expect(readableViewport(bounds, canvas).x).toBe(CANVAS_PAD);
  });

  it("honours a zoom the caller asks for", () => {
    const bounds = { x: 0, y: 0, width: 400, height: 300 };
    const viewport = readableViewport(bounds, canvas, 2);
    expect(viewport.zoom).toBe(2);
    expect(project(bounds.y, viewport.y, viewport.zoom)).toBe(CANVAS_PAD);
  });

  it("returns whole pixels, so nothing lands on a half-device-pixel", () => {
    const bounds = { x: 3, y: 7, width: 333, height: 111 };
    const viewport = readableViewport(bounds, canvas);
    expect(Number.isInteger(viewport.x)).toBe(true);
    expect(Number.isInteger(viewport.y)).toBe(true);
  });
});

describe("boundsOf", () => {
  it("has nothing to say about a line with no points", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("boxes a polyline, wherever its ends happen to be", () => {
    // Deliberately not monotonic: an edge routed round a lane doubles back,
    // and the box has to hold the detour rather than just the endpoints.
    expect(
      boundsOf([
        [830, 1769],
        [1245, 1510],
        [1917, 1647],
      ]),
    ).toEqual({ x: 830, y: 1510, width: 1087, height: 259 });
  });
});

describe("centredViewport", () => {
  it("puts the point in the middle of the canvas", () => {
    const vp = centredViewport({ x: 300, y: 200 }, { width: 800, height: 600 });
    expect(300 * vp.zoom + vp.x).toBe(400);
    expect(200 * vp.zoom + vp.y).toBe(300);
  });
});

describe("focusViewport", () => {
  const canvas = { width: 703, height: 665 };

  /** Where the box lands on screen under a viewport. */
  const project = (b: ReturnType<typeof boundsOf>, vp: { x: number; y: number; zoom: number }) => {
    if (!b) throw new Error("no bounds");
    return {
      left: b.x * vp.zoom + vp.x,
      right: (b.x + b.width) * vp.zoom + vp.x,
      top: b.y * vp.zoom + vp.y,
      bottom: (b.y + b.height) * vp.zoom + vp.y,
    };
  };

  it("gets an arrow wider than the canvas wholly on screen", () => {
    // checkout's step 12 in the diagram variant: 1087pt of arrow in a 703px
    // pane. LikeC4's own centring caps the zoom at 1 and leaves it hanging off
    // the right-hand edge; this is the case the helper exists for.
    const bounds = { x: 830, y: 1509, width: 1087, height: 260 };
    const vp = focusViewport(bounds, canvas);
    const at = project(bounds, vp);
    // Within a pixel: the viewport is rounded to whole pixels on purpose, so
    // nothing lands on a half-device-pixel and blurs.
    expect(at.left).toBeCloseTo(CANVAS_PAD, 0);
    expect(canvas.width - at.right).toBeCloseTo(CANVAS_PAD, 0);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.bottom).toBeLessThanOrEqual(canvas.height);
  });

  it("does not magnify a short arrow past the readable size", () => {
    const bounds = { x: 0, y: 0, width: 40, height: 10 };
    expect(focusViewport(bounds, canvas).zoom).toBe(READABLE_ZOOM);
  });

  it("centres whatever it is shown", () => {
    const bounds = { x: 100, y: 4000, width: 200, height: 80 };
    const vp = focusViewport(bounds, canvas);
    const at = project(bounds, vp);
    // Equal margins either side, to within the whole-pixel rounding.
    expect(Math.abs(at.left - (canvas.width - at.right))).toBeLessThanOrEqual(1);
    expect(Math.abs(at.top - (canvas.height - at.bottom))).toBeLessThanOrEqual(1);
  });

  it("stops zooming out at the floor rather than vanishing", () => {
    const monstrous = { x: 0, y: 0, width: 100000, height: 100000 };
    expect(focusViewport(monstrous, canvas).zoom).toBe(MIN_FOCUS_ZOOM);
  });

  it("survives a zero-height arrow, which is what a straight one is", () => {
    const flat = { x: 0, y: 500, width: 300, height: 0 };
    const vp = focusViewport(flat, canvas);
    expect(vp.zoom).toBe(READABLE_ZOOM);
    expect(Number.isFinite(vp.x) && Number.isFinite(vp.y)).toBe(true);
  });
});
