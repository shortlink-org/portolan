import { describe, expect, it } from "vitest";
import {
  buildFrameCss,
  buildOffPathCss,
  buildWalkthroughCss,
} from "./frame-theme";

describe("buildFrameCss", () => {
  const css = buildFrameCss();

  it("retunes every subflow keyword the generator can emit", () => {
    // `break` is the one portolan's own generator writes, for a terminal alt
    // branch; the others come with LikeC4's vocabulary.
    for (const keyword of ["alt", "par", "loop", "break"]) {
      expect(css).toContain(`--colors-subflow-${keyword}:`);
      expect(css).toContain(`--colors-subflow-${keyword}-border:`);
      expect(css).toContain(`--colors-subflow-${keyword}-text:`);
    }
  });

  it("paints only in portolan tokens, so a theme swap carries the canvas", () => {
    const values = css
      .split("\n")
      .filter((line) => line.includes(":") && !line.includes("{"))
      .map((line) => line.slice(line.indexOf(":") + 1));
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/var\(--(surface|surface-2|border|border-strong|fg-muted)\)/);
    }
  });

  it("scopes itself to the canvas rather than the document", () => {
    expect(css.startsWith(".react-flow {")).toBe(true);
  });
});

describe("buildOffPathCss", () => {
  it("says nothing when every frame is on the path", () => {
    expect(buildOffPathCss([])).toBe("");
  });

  it("dims the frames it is given, and does not hide them", () => {
    const css = buildOffPathCss(["step-07:alt.02:else"]);
    expect(css).toContain('[data-id="step-07:alt.02:else"]');
    expect(css).toContain("opacity");
    expect(css).not.toContain("display: none");
  });

  it("escapes a quote rather than letting it close the selector", () => {
    expect(buildOffPathCss(['a"b'])).toContain('data-id="a\\"b"');
  });
});

describe("buildWalkthroughCss", () => {
  const css = buildWalkthroughCss();

  it("hides the panel LikeC4 opens over the canvas during playback", () => {
    expect(css).toContain("display: none");
  });

  it("aims only at a full-height box in the diagram's top-left corner", () => {
    // Narrow on purpose: anything looser would take the canvas with it.
    expect(css).toContain(".likec4-root >");
    expect(css).toContain(".pos_absolute");
    expect(css).toContain(".top_0");
    expect(css).toContain(".left_0");
    expect(css).toContain(".h_100cqh");
  });
});
