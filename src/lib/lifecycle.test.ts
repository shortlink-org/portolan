import { describe, expect, it } from "vitest";
import type { Lifecycle } from "../catalog";
import { columnsOf, isTerminal, layoutLifecycle, METRICS } from "./lifecycle";

const fan: Lifecycle = {
  states: ["open", "checked-out", "abandoned", "merged"],
  transitions: [
    { from: "open", to: "checked-out", on: "checkout", emits: "e.CheckedOut" },
    { from: "open", to: "abandoned", on: "abandon" },
    { from: "open", to: "merged", on: "mergeInto" },
  ],
};

const chain: Lifecycle = {
  states: ["draft", "sent", "paid", "void"],
  transitions: [
    { from: "draft", to: "sent", on: "send" },
    { from: "sent", to: "paid", on: "settle" },
    { from: "sent", to: "draft", on: "recall" },
    { from: "sent", to: "void", on: "cancel" },
  ],
};

describe("a lifecycle", () => {
  it("starts where the code starts, and ends where nothing leads out", () => {
    expect(isTerminal(fan, "open")).toBe(false);
    for (const s of ["checked-out", "abandoned", "merged"]) expect(isTerminal(fan, s)).toBe(true);
    expect(layoutLifecycle(fan).boxes.map((b) => [b.state, b.initial, b.terminal])).toEqual([
      ["open", true, false],
      ["checked-out", false, true],
      ["abandoned", false, true],
      ["merged", false, true],
    ]);
  });

  it("is columned by distance from the initial state, in the code's own row order", () => {
    expect([...columnsOf(fan)]).toEqual([["open", 0], ["checked-out", 1], ["abandoned", 1], ["merged", 1]]);
    expect([...columnsOf(chain)]).toEqual([["draft", 0], ["sent", 1], ["paid", 2], ["void", 2]]);
  });

  it("puts a state nothing reaches in a column of its own, rather than losing it", () => {
    const stray: Lifecycle = { states: ["a", "b", "lost"], transitions: [{ from: "a", to: "b", on: "go" }] };
    expect(columnsOf(stray).get("lost")).toBe(2);
    expect(layoutLifecycle(stray).boxes).toHaveLength(3);
  });

  it("draws a fan as one column centred on the other", () => {
    const { boxes, width, height } = layoutLifecycle(fan);
    const open = boxes[0]!;
    const targets = boxes.slice(1);
    const middle = targets[1]!;
    expect(open.y).toBe(middle.y);
    expect(targets.every((b) => b.x === targets[0]!.x && b.x > open.x)).toBe(true);
    expect(width).toBe(METRICS.pad * 2 + 2 * METRICS.boxWidth + METRICS.gapX);
    expect(height).toBe(METRICS.pad * 2 + 3 * METRICS.boxHeight + 2 * METRICS.gapY);
  });

  it("draws a move back underneath, and makes room for it", () => {
    const { edges, height } = layoutLifecycle(chain);
    const recall = edges.find((e) => e.on === "recall")!;
    expect(recall.back).toBe(true);
    expect(edges.filter((e) => e.back)).toHaveLength(1);
    expect(recall.labelY).toBeGreaterThan(edges.find((e) => e.on === "send")!.labelY);
    const flat: Lifecycle = { ...chain, transitions: chain.transitions.filter((t) => t.on !== "recall") };
    expect(height).toBeGreaterThan(layoutLifecycle(flat).height);
    for (const e of edges) expect(e.path.startsWith("M ")).toBe(true);
  });

  it("carries what the transition said through to the edge", () => {
    const checkout = layoutLifecycle(fan).edges[0]!;
    expect(checkout.on).toBe("checkout");
    expect(checkout.emits).toBe("e.CheckedOut");
  });
});
