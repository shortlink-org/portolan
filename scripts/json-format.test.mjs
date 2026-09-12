import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatLike, parseWithRanges } from "./json-format.mjs";

const manifest = `{
  "$schema": "./schema/portolan.schema.json",
  "sources": ["portolan/*.json", "examples/*/portolan/*.json"],
  "projects": [
    {
      "id": "auth",
      "root": "examples/auth"
    }
  ],
  "verify": [
    {
      "plugin": "otel",
      "in": "examples/auth",
      "options": {
        "traces": [
          "telemetry/traces.jsonl"
        ],
        "out": "observed.json"
      }
    }
  ],
  "empty": [],
  "number": 1e3
}`;

function lines(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  return y.filter((line) => !x.includes(line));
}

describe("writing a value the way the file already writes it", () => {
  it("copies the text back byte for byte when nothing changed", () => {
    expect(formatLike(manifest, JSON.parse(manifest))).toBe(manifest);
  });

  it("changes only the line that changed, in the style the array had", () => {
    const next = JSON.parse(manifest);
    next.verify[0].options.traces.push("telemetry/recordings/*.jsonl");
    next.sources.push("data/*.json");
    const out = formatLike(manifest, next);

    expect(JSON.parse(out)).toEqual(next);
    expect(lines(manifest, out)).toEqual([
      '  "sources": ["portolan/*.json", "examples/*/portolan/*.json", "data/*.json"],',
      '          "telemetry/traces.jsonl",',
      '          "telemetry/recordings/*.jsonl"',
    ]);
  });

  it("keeps the old key order and appends a new key after it", () => {
    const next = { ...JSON.parse(manifest), added: { a: 1 } };
    delete next.empty;
    const out = formatLike(manifest, next);

    expect(out.indexOf('"$schema"')).toBeLessThan(out.indexOf('"sources"'));
    expect(out).not.toContain('"empty"');
    expect(out.endsWith('  "number": 1e3,\n  "added": {\n    "a": 1\n  }\n}')).toBe(true);
  });

  it("writes something with no old self the default way: scalars inline, objects spread", () => {
    const next = JSON.parse(manifest);
    next.verify.push({ plugin: "codeowners", in: ".github", out: "data", options: { files: ["CODEOWNERS"], nested: [{ a: 1 }] } });
    const out = formatLike(manifest, next);

    expect(JSON.parse(out)).toEqual(next);
    expect(out).toContain('    {\n      "plugin": "codeowners",\n      "in": ".github",\n      "out": "data",\n      "options": {\n        "files": ["CODEOWNERS"],\n        "nested": [\n          {\n            "a": 1\n          }\n        ]\n      }\n    }\n  ],');
  });

  it("keeps a spread array spread even when an element is replaced", () => {
    const next = JSON.parse(manifest);
    next.verify[0].options.traces = ["telemetry/other.jsonl"];
    const out = formatLike(manifest, next);
    expect(out).toContain('"traces": [\n          "telemetry/other.jsonl"\n        ],');
  });

  it("falls back to plain JSON when the old text is not JSON", () => {
    expect(formatLike("not json", { a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });

  it("reads the repository's own manifest back unchanged", () => {
    const text = readFileSync(new URL("../portolan.json", import.meta.url), "utf8").replace(/\n$/, "");
    expect(parseWithRanges(text).value).toEqual(JSON.parse(text));
    expect(formatLike(text, JSON.parse(text))).toBe(text);
  });

  it("parses strings with escapes and rejects what JSON.parse rejects", () => {
    expect(parseWithRanges('{"a": "x\\"y", "b": [true, null, -1.5e2]}').value).toEqual({ a: 'x"y', b: [true, null, -150] });
    expect(() => parseWithRanges('{"a": 1,}')).toThrow();
    expect(() => parseWithRanges("[1] 2")).toThrow();
  });
});
