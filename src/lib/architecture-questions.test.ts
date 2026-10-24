import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import { architectureQuestion } from "./architecture-questions";
import { paletteItems } from "./palette";

const items = paletteItems(catalog);

describe("architecture questions", () => {
  it("turns a caller question into service evidence links", () => {
    const answer = architectureQuestion(items, "who calls cart?");
    expect(answer?.result?.hits[0]?.item.kind).toBe("service");
    expect(answer?.result?.hits[0]?.item.path).toContain("#links-here");
    expect(answer?.result?.hits[0]?.item.selectId).toBeUndefined();
  });

  it("takes unresolved relationships straight to their work queue", () => {
    expect(architectureQuestion(items, "show unresolved relationships")?.action)
      .toEqual({
        label: "Open unresolved relationships",
        path: "/problems",
      });
  });
});
