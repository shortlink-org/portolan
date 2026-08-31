import { describe, expect, it } from "vitest";
import { buildHighlightCss } from "./highlight-css";

describe("buildHighlightCss", () => {
  it("writes nothing when nothing is selected", () => {
    expect(buildHighlightCss([], [])).toBe("");
  });

  it("dims the other nodes and outlines the one", () => {
    const css = buildHighlightCss(["shop.oms"], []);
    expect(css).toContain('.react-flow__node:not([data-id="shop.oms"])');
    expect(css).toContain('.react-flow__node[data-id="shop.oms"]');
    expect(css).toContain("outline: 2px solid var(--accent)");
  });

  /**
   * Nodes and edges are dimmed independently. Lighting a step must not grey out
   * the lanes it runs between, so an edge highlight leaves the nodes alone.
   */
  it("keeps the two categories apart", () => {
    const edgesOnly = buildHighlightCss([], ["step-01", "step-02"]);
    expect(edgesOnly).not.toContain(".react-flow__node");
    expect(edgesOnly).toContain(
      '.react-flow__edge:not([data-id="step-01"]):not([data-id="step-02"])',
    );
  });

  it("touches nothing but opacity and outline, so no layout can move", () => {
    const css = buildHighlightCss(["a"], ["b"]);
    for (const rule of css.split("\n")) {
      const body = rule.slice(rule.indexOf("{") + 1, rule.lastIndexOf("}"));
      for (const decl of body.split(";")) {
        const property = decl.split(":")[0]?.trim();
        if (!property) continue;
        expect(["opacity", "outline", "outline-offset", "transition"]).toContain(
          property,
        );
      }
    }
  });

  it("escapes a quote in an id rather than breaking out of the selector", () => {
    const css = buildHighlightCss(['a"b'], []);
    expect(css).toContain('[data-id="a\\"b"]');
  });
});
