import { describe, expect, it } from "vitest";
import { likec4model } from "./generated";
import { BOXES, legendFrom, viewLegend } from "./legend";

describe("C4 legend", () => {
  it("explains every element kind the generator can draw", () => {
    const { elements, deployments } = likec4model.$data.specification;
    const kinds = [...Object.keys(elements), ...Object.keys(deployments ?? {})];
    expect(kinds.filter((kind) => !(kind in BOXES))).toEqual([]);
  });

  it("names every box and arrow of every generated view", () => {
    for (const viewId of Object.keys(likec4model.$data.views)) {
      const view = likec4model.findView(viewId)?.$layouted;
      if (!view || view._type === "dynamic") continue;
      const legend = viewLegend(viewId)!;
      const kinds = new Set(legend.boxes.map((box) => box.kind));
      expect(view.nodes.filter((node) => !kinds.has(node.kind)).map((node) => node.id), viewId).toEqual([]);
      if (view.edges.length) expect(legend.arrows.length, viewId).toBeGreaterThan(0);
    }
  });

  it("lists only what the picture draws", () => {
    const legend = legendFrom(
      [{ kind: "service", color: "ctx2" }, { kind: "store", color: "muted" }, { kind: "service", color: "ctx0" }],
      [
        { kind: "calls", color: "declared", head: "normal" },
        { kind: "owns", color: "muted", head: "none" },
        { kind: "calls", color: "declared", head: "normal" },
      ],
    );
    expect(legend.boxes.map((box) => box.kind)).toEqual(["service", "store"]);
    expect(legend.contexts).toEqual([0, 2]);
    expect(legend.arrows.map((arrow) => arrow.name)).toEqual(["Call", "Owns"]);
    expect(legend.evidence.map((entry) => entry.status)).toEqual(["declared"]);
  });

  it("explains a folded arrow by its head and its grey as mixed evidence", () => {
    const legend = legendFrom([], [{ color: "gray", head: "normal" }, { kind: "publishes_to", color: "verified", head: "onormal" }]);
    expect(legend.arrows.map((arrow) => [arrow.name, arrow.head])).toEqual([["Event", "onormal"], ["Call or use", "normal"]]);
    expect(legend.evidence.map((entry) => entry.status)).toEqual(["verified", "mixed"]);
  });

  it("gathers the abbreviations of names and technologies, once each", () => {
    const legend = legendFrom(
      [{ kind: "service", color: "ctx0", title: "Storefront BFF", technology: "Node.js · GraphQL" }, { kind: "broker", color: "muted", title: "bus", technology: "NATS" }],
      [{ kind: "calls", color: "declared", head: "normal", technology: "HTTP" }, { kind: "calls", color: "declared", head: "normal", technology: "HTTP" }],
    );
    expect(legend.abbreviations).toEqual(["BFF", "NATS", "HTTP"]);
  });
});
