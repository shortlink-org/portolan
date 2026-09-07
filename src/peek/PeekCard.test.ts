import { describe, expect, it } from "vitest";
import { CARD_WIDTH, placeCard } from "./PeekCard";

const viewport = { width: 1200, height: 800 };

describe("placeCard", () => {
  it("opens below the anchor, at its left", () => {
    expect(placeCard({ left: 100, top: 200, bottom: 220 }, 150, viewport)).toEqual({
      left: 100,
      top: 226,
    });
  });

  it("flips above when the bottom of the window is too close", () => {
    expect(placeCard({ left: 100, top: 700, bottom: 720 }, 150, viewport)).toEqual({
      left: 100,
      top: 700 - 6 - 150,
    });
  });

  it("stays below when there is no room above either", () => {
    const at = placeCard({ left: 100, top: 20, bottom: 40 }, 790, viewport);
    expect(at.top).toBe(46);
  });

  it("keeps the card inside the window on the right", () => {
    const at = placeCard({ left: 1150, top: 200, bottom: 220 }, 150, viewport);
    expect(at.left).toBe(viewport.width - CARD_WIDTH - 8);
  });

  it("keeps the card inside the window on the left", () => {
    const at = placeCard({ left: -40, top: 200, bottom: 220 }, 150, viewport);
    expect(at.left).toBe(8);
  });
});
