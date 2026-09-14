import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const baseline = css.match(/@layer base\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
describe("shared button interaction baseline", () => {
  it("covers native, ARIA, input and opt-in buttons without per-button classes", () => {
    const rule = baseline.split("}")[0];
    for (const selector of ["button", '[role="button"]', 'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]', ".button-base"]) expect(rule).toContain(selector);
    expect(rule).toContain("cursor: pointer;");
  });
  it("provides a visible hover fallback only for enabled buttons and hover-capable pointers", () => {
    expect(baseline).toContain("@media (hover: hover)");
    expect(baseline).toContain(':not(:disabled):not([aria-disabled="true"]):hover');
    expect(baseline).toContain("box-shadow: inset");
    expect(baseline).toContain("var(--accent) 8%");
    expect(css).toContain('.tbtn:not(:disabled):not([aria-disabled="true"]):hover');
    expect(css).toContain("@apply bg-raised border-line-strong text-ink;");
    expect(css).not.toContain(".tbtn:hover {");
  });
  it("covers native and ARIA-disabled states without disabling pointer events", () => {
    expect(baseline).toMatch(/:is\(:disabled, \[aria-disabled="true"\]\)\s*\{\s*cursor: not-allowed;/);
    expect(baseline).not.toContain("pointer-events");
    expect(baseline).not.toContain("!important");
  });
});
