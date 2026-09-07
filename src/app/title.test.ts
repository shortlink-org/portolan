import { describe, expect, it } from "vitest";
import { pageTitle } from "./title";

describe("pageTitle", () => {
  it("puts the page's name before the app's", () => {
    expect(pageTitle("Orders")).toBe("Orders · portolan");
  });

  it("falls back to the app's name when the page has none", () => {
    expect(pageTitle(undefined)).toBe("portolan");
    expect(pageTitle(null)).toBe("portolan");
    expect(pageTitle("   ")).toBe("portolan");
  });
});
