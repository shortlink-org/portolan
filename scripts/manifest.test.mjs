// The manifest is checked against the schema the plugins describe, so these
// run against the committed schema/portolan.schema.json rather than a fixture:
// what is worth asserting is that the real document catches a real typo.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadManifest } from "./manifest.mjs";

const dir = mkdtempSync(join(tmpdir(), "portolan-manifest-"));

/** Writes a manifest to a scratch file and validates it. */
function check(manifest) {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(manifest));

  return loadManifest(path).problems;
}

const good = {
  sources: ["data/*.json"],
  plugins: [{ name: "go-domain", process: { cmd: "go run ./plugins/extract-go" } }],
  extract: [
    {
      plugin: "go-domain",
      in: "examples/auth",
      out: "examples/auth/portolan",
      options: { context: "auth", contextSummary: "Who someone is." },
    },
  ],
};

describe("the manifest schema", () => {
  it("accepts the manifest this repository ships", () => {
    expect(loadManifest("portolan.json").problems).toEqual([]);
  });

  it("accepts a well-formed manifest", () => {
    expect(check(good)).toEqual([]);
  });

  it("names the option a typo was probably meant to be", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { context: "auth", contextSummry: "..." } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("contextSummry");
    expect(problems[0]).toContain('did you mean "contextSummary"');
  });

  it("lists the known options when a key resembles nothing", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { database: "pg" } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).not.toContain("did you mean");
    expect(problems[0]).toContain("known: context,");
  });

  it("refuses an option whose value is not one the plugin accepts", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], options: { classification: "essential" } }],
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("core, supporting, generic");
  });

  it("refuses a renderer where an extractor goes", () => {
    const problems = check({
      ...good,
      extract: [{ ...good.extract[0], plugin: "markdown" }],
    });

    expect(problems.join("\n")).toContain("go-domain");
  });

  it("refuses a step that names no output", () => {
    const { out, ...step } = good.extract[0];
    const problems = check({ ...good, extract: [step] });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('extract/0: "out" is missing');
  });
});
