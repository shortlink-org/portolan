import { describe, expect, it } from "vitest";
import { overviewFinding } from "./overview-summary";

describe("overviewFinding", () => {
  it("states the actionable finding and its measured scope", () => {
    expect(
      overviewFinding({ contexts: 1, services: 3, flows: 1, problems: 2, errors: 0 }),
    ).toBe("0 errors and 2 warnings across 1 context, 3 services and 1 flow.");
  });

  it("does not turn an empty problem list into a vague healthy status", () => {
    expect(
      overviewFinding({ contexts: 2, services: 8, flows: 5, problems: 0, errors: 0 }),
    ).toBe("No catalog problems across 2 contexts, 8 services and 5 flows.");
  });
});
