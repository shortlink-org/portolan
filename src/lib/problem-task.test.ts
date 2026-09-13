import { describe, expect, it } from "vitest";
import type { Problem } from "./derive";
import { problemTaskMarkdown } from "./problem-task";

const problem: Problem = {
  rule: "missing-provider", severity: "error", context: "shop", service: "shop.cart",
  id: "cart.Get", peer: "orders.Get", note: "No provider answers orders.Get.", source: "src/cart.ts:42",
};

describe("copying a problem as a task", () => {
  it("carries the finding, recommendation and working catalog/source links", () => {
    const url = "https://example.org/portolan/problems?catalog=example&rule=missing-provider&q=cart.Get";
    const markdown = problemTaskMarkdown(problem, {
      title: "Missing provider", description: "A call has no provider.", action: "Add the missing contract.",
    }, url, "https://github.com/example/shop/blob/abc/src/cart.ts#L42");
    expect(markdown).toContain("### Missing provider: cart.Get");
    expect(markdown).toContain("- Rule: missing-provider\n- Severity: error\n- Context: shop\n- Service: shop.cart");
    expect(markdown).toContain("- Related entity: orders.Get");
    expect(markdown).toContain(problem.note);
    expect(markdown).toContain("**Recommended action:** Add the missing contract.");
    expect(markdown).toContain("Source: [src/cart.ts:42](<https://github.com/example/shop/blob/abc/src/cart.ts#L42>)");
    expect(markdown).toContain(`[Open in Portolan](<${url}>)`);
  });

  it("keeps a useful task when a rule, source URL or ownership is absent", () => {
    const markdown = problemTaskMarkdown({ ...problem, context: "", service: "", peer: "", note: undefined }, undefined, "https://example.org/problems");
    expect(markdown).toContain("### missing-provider: cart.Get");
    expect(markdown).toContain("Source: src/cart.ts:42");
    expect(markdown).not.toMatch(/undefined|null|Service:|Context:|Related entity:|Recommended action:/);
  });

  it("keeps source-controlled Markdown characters literal", () => {
    const markdown = problemTaskMarkdown({ ...problem, id: "[link](url)", note: "first\n# heading <tag>" }, undefined, "https://example.org/problems");
    expect(markdown).toContain("\\[link\\]\\(url\\)");
    expect(markdown).toContain("first \\# heading \\<tag\\>");
  });
});
