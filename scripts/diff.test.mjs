import { describe, expect, it } from "vitest";

import { globToRegExp, parseArgs, render, renderJson, renderSarif } from "./diff.mjs";

describe("globToRegExp", () => {
  // The manifest's own patterns, which is the whole reason this exists: the
  // working tree's side is globbed by `fs.glob` and the ref's side by this, so
  // the two must agree about which files are sources.
  it("matches what the manifest means by one star", () => {
    const re = globToRegExp("examples/*/portolan/*.json");

    expect(re.test("examples/auth/portolan/domain.json")).toBe(true);
    expect(re.test("examples/shop/oms/portolan/domain.json")).toBe(false);
    expect(re.test("examples/auth/portolan/domain.json.bak")).toBe(false);
  });

  it("lets two stars cross a slash", () => {
    const re = globToRegExp("examples/**/portolan/*.json");

    expect(re.test("examples/shop/oms/portolan/domain.json")).toBe(true);
    expect(re.test("examples/auth/portolan/domain.json")).toBe(true);
  });

  it("anchors at both ends", () => {
    const re = globToRegExp("data/*.json");

    expect(re.test("data/adr.json")).toBe(true);
    expect(re.test("vendor/data/adr.json")).toBe(false);
    expect(re.test("data/adr/0001.md")).toBe(false);
  });

  // A dot is a dot. Left unescaped, `data/*.json` would also match a file
  // called `data/adrxjson`, which is not a thing anybody has but is exactly
  // the kind of quiet wrongness a source list should not have.
  it("takes a dot literally", () => {
    expect(globToRegExp("data/*.json").test("data/adrxjson")).toBe(false);
  });
});

describe("render", () => {
  it("says so plainly when nothing moved", () => {
    expect(render("main", [])).toBe("No architectural change against `main`.\n");
  });

  it("groups by severity, breaking first", () => {
    const out = render("main", [
      { kind: "event.removed", severity: "breaking", where: "a", summary: "A is gone" },
      { kind: "event.added", severity: "addition", where: "b", summary: "B is new" },
      { kind: "owner.added", severity: "change", where: "c", summary: "C changed hands" },
    ]);

    expect(out).toContain("3 changes.");
    expect(out.indexOf("Breaking")).toBeLessThan(out.indexOf("Added"));
    expect(out.indexOf("Added")).toBeLessThan(out.indexOf("Changed"));
    expect(out).toContain("- A is gone");
  });

  it("leaves out a severity nothing landed in", () => {
    const out = render("main", [
      { kind: "event.added", severity: "addition", where: "b", summary: "B is new" },
    ]);

    expect(out).toContain("1 change.");
    expect(out).not.toContain("Breaking");
  });
});

describe("machine formats", () => {
  const changes = [
    { kind: "event.removed", severity: "breaking", where: "shop.order", summary: "event is gone" },
    { kind: "owner.added", severity: "change", where: "shop.cart", summary: "owner changed" },
  ];

  it("parses a ref, format and output in either option spelling", () => {
    expect(parseArgs(["main", "--format=json", "--output", "report.json"])).toEqual({
      ref: "main", format: "json", output: "report.json",
    });
  });

  it("exports a versioned JSON report with counts", () => {
    const report = JSON.parse(renderJson("main", changes));
    expect(report).toMatchObject({ version: 1, base: "main", counts: { breaking: 1, change: 1, addition: 0 } });
    expect(report.changes).toEqual(changes);
  });

  it("maps breaking changes to SARIF errors", () => {
    const report = JSON.parse(renderSarif("main", changes));
    expect(report.version).toBe("2.1.0");
    expect(report.runs[0].results[0]).toMatchObject({ ruleId: "event.removed", level: "error" });
    expect(report.runs[0].results[0].properties.where).toBe("shop.order");
  });
});
