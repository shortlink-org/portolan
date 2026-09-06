import { describe, expect, it } from "vitest";
import { clipPage, instructions, pagePath, PAGE_LIMIT } from "./prompt";

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
});
