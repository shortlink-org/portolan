import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins conditional classes", () => {
    expect(cn("chip", false, { "is-on": true, hidden: false })).toBe(
      "chip is-on",
    );
  });

  it("lets a caller override conflicting Tailwind utilities", () => {
    expect(cn("p-1 text-muted", "p-3 text-accent")).toBe(
      "p-3 text-accent",
    );
  });
});
