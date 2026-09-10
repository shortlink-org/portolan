import { describe, expect, it } from "vitest";

import { explainChange, jsonDifference, lineDifference } from "./output-diff.mjs";

describe("explainChange", () => {
  it("names the JSON path and both values", () => {
    const current = JSON.stringify({ contexts: [{ services: [{ commands: [{ source: "package.json:58" }] }] }] });
    const wanted = JSON.stringify({ contexts: [{ services: [{ commands: [{ source: "package.json:59" }] }] }] });
    expect(explainChange(current, wanted, "commands.json")).toBe(
      'contexts[0].services[0].commands[0].source: "package.json:58" → "package.json:59"',
    );
  });

  it("says what was added, what was removed, and when a list grew", () => {
    expect(jsonDifference('{"a":1}', '{"a":1,"b":{"x":1,"y":2}}')).toBe("b: added {x, y}");
    expect(jsonDifference('{"a":1,"b":2}', '{"a":1}')).toBe("b: removed");
    expect(jsonDifference('{"flows":[1]}', '{"flows":[1,2,3]}')).toBe("flows: 1 item → 3");
  });

  it("falls back to lines for text, and for JSON that does not parse", () => {
    expect(lineDifference("a\nb\nc", "a\nB\nc")).toBe('line 2: "b" → "B"');
    expect(lineDifference("a\nb", "a\nb\nc\nd")).toBe("line 3: 2 lines added");
    expect(lineDifference("a\nb\nc", "a")).toBe("line 2: 2 lines removed");
    expect(explainChange("{not json", "{still not", "x.json")).toBe('line 1: "{not json" → "{still not"');
  });

  it("knows a file that is not there yet, and a binary one", () => {
    expect(explainChange(null, "x", "x.md")).toBe("not on disk yet");
    expect(explainChange(Buffer.from([1]), Buffer.from([2]), "x.png")).toBe("binary contents differ");
  });

  it("keeps a long value readable", () => {
    const long = "x".repeat(200);
    expect(jsonDifference('{"a":"short"}', `{"a":"${long}"}`)).toMatch(/^a: "short" → "x{56}…$/);
  });
});
