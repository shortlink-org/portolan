import { describe, expect, it } from "vitest";
import { buildIndex } from "../catalog";
import { catalog } from "../testing/estate";
import { evaluateProblems } from "./all-problems";
import { resolveRules } from "./problem-rules";

describe("merge conflicts on Problems", () => {
  it("turns a losing catalog claim into an actionable error row", () => {
    const evaluation = evaluateProblems(
      catalog,
      buildIndex(catalog),
      resolveRules([]),
      [{ path: "generated/second.json", where: "flow.checkout", message: "a different flow was ignored" }],
    );
    expect(evaluation.problems[0]).toMatchObject({
      rule: "merge-conflict",
      severity: "error",
      id: "flow.checkout",
      peer: "generated/second.json",
    });
    expect(evaluation.matches.get("merge-conflict")).toBe(1);
  });
});
