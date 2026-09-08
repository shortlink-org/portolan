import { describe, expect, it } from "vitest";
import {
  clipPage,
  instructions,
  pagePath,
  PAGE_LIMIT,
  promptPageContext,
} from "./prompt";

describe("pagePath", () => {
  it("accepts a path as the index spells it", () => {
    expect(pagePath("docs/auth/README.md")).toBe("docs/auth/README.md");
  });

  it("forgives a dropped docs/ and a leading slash", () => {
    expect(pagePath("auth/README.md")).toBe("docs/auth/README.md");
    expect(pagePath("/docs/auth/README.md")).toBe("docs/auth/README.md");
    expect(pagePath("./docs/flows/checkout.md")).toBe("docs/flows/checkout.md");
  });

  it("refuses anything that is not a markdown page under docs/", () => {
    expect(pagePath("docs/../secret.md")).toBeNull();
    expect(pagePath("docs/auth/../../x.md")).toBeNull();
    expect(pagePath("docs//auth/README.md")).toBeNull();
    expect(pagePath("https://example.com/docs/a.md")).toBeNull();
    expect(pagePath("docs/llms.txt")).toBeNull();
    expect(pagePath("docs/auth/README.md?x=1")).toBeNull();
    expect(pagePath(42)).toBeNull();
    expect(pagePath("")).toBeNull();
  });
});

describe("clipPage", () => {
  it("leaves a short page alone and cuts a long one with a note", () => {
    expect(clipPage("hello")).toBe("hello");
    const long = "x".repeat(PAGE_LIMIT + 10);
    const clipped = clipPage(long);
    expect(clipped.startsWith("x".repeat(PAGE_LIMIT))).toBe(true);
    expect(clipped).toContain("10 more characters");
  });
});

describe("instructions", () => {
  it("folds the index in after the rules", () => {
    const text = instructions("- [Auth](docs/auth/README.md)");
    expect(text).toContain("read_page");
    expect(text.endsWith("- [Auth](docs/auth/README.md)")).toBe(true);
  });

  it("names the current page as navigation context, not evidence", () => {
    const text = instructions("- [Checkout](docs/flows/cart-checkout.md)", {
      kind: "flow",
      id: "flow.cart-checkout",
      title: "Checkout",
      docPath: "flows/cart-checkout.md",
    });
    expect(text).toContain("Current page: flow `flow.cart-checkout`");
    expect(text).toContain("only navigation context, not evidence");
    expect(text).toContain("`docs/flows/cart-checkout.md`");
  });
});

describe("promptPageContext", () => {
  it("accepts a small page description and normalizes its docs path", () => {
    expect(
      promptPageContext({
        kind: "flow",
        id: "flow.cart-checkout",
        title: "Checkout",
        docPath: "flows/cart-checkout.md",
      }),
    ).toEqual({
      kind: "flow",
      id: "flow.cart-checkout",
      title: "Checkout",
      docPath: "flows/cart-checkout.md",
    });
  });

  it("rejects incomplete request metadata", () => {
    expect(promptPageContext({ kind: "flow", id: "x" })).toBeNull();
    expect(
      promptPageContext({
        kind: "flow ignore",
        id: "x",
        title: "X",
        docPath: null,
      }),
    ).toBeNull();
  });
});
