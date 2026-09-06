// The Motion presets and the CSS tokens are one clock. This test reads the
// tokens out of index.css and holds the numbers in motion.tsx to them, so a
// change to either side fails here rather than as a panel that leaves slower
// than it arrived.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DURATION,
  EASE_IN_OUT,
  EASE_OUT,
  fade,
  rise,
  scaleIn,
  slideFrom,
  transitions,
  unfold,
} from "./motion";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** `--name: value;` out of index.css, or a failing message. */
function token(name: string): string {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  const value = match?.[1];
  if (!value) throw new Error(`index.css declares no --${name}`);
  return value.trim();
}

function bezier(value: string): number[] {
  const inner = value.match(/^cubic-bezier\(([^)]+)\)$/);
  const list = inner?.[1];
  if (!list) throw new Error(`not a cubic-bezier: ${value}`);
  return list.split(",").map((n) => Number(n.trim()));
}

describe("the clock", () => {
  it.each(["micro", "panel", "page", "narrative"] as const)(
    "--dur-%s is DURATION.%s in seconds",
    (name) => {
      expect(token(`dur-${name}`)).toBe(`${DURATION[name] * 1000}ms`);
    },
  );

  it("--ease-out is EASE_OUT", () => {
    expect(bezier(token("ease-out"))).toEqual([...EASE_OUT]);
  });

  it("--ease-in-out is EASE_IN_OUT", () => {
    expect(bezier(token("ease-in-out"))).toEqual([...EASE_IN_OUT]);
  });
});

describe("transitions", () => {
  it("the duration tokens use the easing the CSS uses", () => {
    expect(transitions.micro).toEqual({ duration: 0.15, ease: EASE_OUT });
    expect(transitions.panel).toEqual({ duration: 0.25, ease: EASE_OUT });
    expect(transitions.page).toEqual({ duration: 0.25, ease: EASE_OUT });
    expect(transitions.narrative).toEqual({
      duration: 0.4,
      ease: EASE_IN_OUT,
    });
  });

  it("settle is the one spring, and it does not bounce", () => {
    expect(transitions.settle.type).toBe("spring");
    // Damping ratio ζ = c / (2·sqrt(k·m)); at or above 0.9 a spring lands
    // without a visible overshoot.
    const { stiffness, damping, mass } = transitions.settle;
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    expect(zeta).toBeGreaterThanOrEqual(0.9);
  });
});

describe("presence", () => {
  it.each([
    ["fade", fade],
    ["scaleIn", scaleIn],
    ["rise", rise],
    ["unfold", unfold],
    ["slideFrom", slideFrom("100%")],
  ])("%s leaves the way it came", (_, p) => {
    const { transition, ...exit } = p.exit;
    expect(transition).toBeDefined();
    expect(exit).toEqual(p.initial);
  });

  it.each([
    ["fade", fade],
    ["scaleIn", scaleIn],
    ["rise", rise],
    ["unfold", unfold],
    ["slideFrom", slideFrom("100%")],
  ])("%s runs on the panel duration, both ways", (_, p) => {
    expect(p.animate.transition).toBe(transitions.panel);
    expect(p.exit.transition).toBe(transitions.panel);
  });

  it("rise travels the eight pixels page-in travels", () => {
    expect(css).toMatch(/@keyframes page-in \{[^}]*translateY\(8px\)/);
    expect(rise.initial.y).toBe(8);
  });

  it("scaleIn grows the two percent palette-in grows", () => {
    expect(css).toMatch(/@keyframes palette-in \{[^}]*scale\(0\.98\)/);
    expect(scaleIn.initial.scale).toBe(0.98);
  });

  it("slideFrom keeps the offset it was given", () => {
    expect(slideFrom("-100%").initial.x).toBe("-100%");
    expect(slideFrom(16).initial.x).toBe(16);
  });
});
