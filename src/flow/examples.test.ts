import { describe, expect, it } from "vitest";

import { exampleRowsFor, formatMs, stepsShownBy } from "./examples";

const example = (traceId: string, ...steps: string[]) => ({
  id: `t.jsonl#${traceId}`,
  recording: "examples/auth/telemetry/t.jsonl",
  traceId,
  durationMs: 3,
  steps: steps.map((step, i) => ({ step, durationMs: i + 1, attributes: { "http.route": "/x" } })),
});

describe("what the recordings said about one step", () => {
  it("is every trace that showed it, in the flow's order, with what the span said", () => {
    const flow = { examples: [example("a", "s1", "s2"), example("b", "s2", "s2"), example("c", "s3")] };
    const rows = exampleRowsFor(flow, { id: "s2" });
    expect(rows.map((row) => `${row.example.traceId}:${row.shown.durationMs}`)).toEqual(["a:2", "b:1", "b:2"]);
    expect(exampleRowsFor(flow, { id: "s9" })).toEqual([]);
    expect(exampleRowsFor({}, { id: "s1" })).toEqual([]);
  });

  it("names the distinct steps a recording showed, once each, in order", () => {
    expect(stepsShownBy(example("a", "s2", "s1", "s2"))).toEqual(["s2", "s1"]);
  });

  it("says milliseconds the way a reader does", () => {
    expect(formatMs(0.42)).toBe("0.42 ms");
    expect(formatMs(2.6)).toBe("2.6 ms");
    expect(formatMs(41.39)).toBe("41 ms");
    expect(formatMs(1300)).toBe("1.3 s");
    expect(formatMs(12_000)).toBe("12 s");
  });
});
