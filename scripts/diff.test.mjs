import { describe, expect, it } from "vitest";

import { changesHref, globToRegExp, locate, parseArgs, render, renderJson, renderSarif } from "./diff.mjs";

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

  // The list is for the review; the page is for understanding it. The link
  // is the last line, only when there is a site to link to, and only when
  // there is something to look at.
  it("ends with a link into the Changes page when it knows the site", () => {
    const changes = [{ kind: "event.added", severity: "addition", where: "b", summary: "B is new" }];

    expect(render("origin/main", changes, { site: "https://acme.github.io/shop/", head: "feat/x" }))
      .toMatch(/\[Open in Changes\]\(https:\/\/acme\.github\.io\/shop\/changes\?base=main&head=feat%2Fx\)\n$/);
    expect(render("origin/main", changes)).not.toContain("Open in Changes");
    expect(render("origin/main", [], { site: "https://acme.github.io/shop" })).not.toContain("Open in Changes");
  });
});

describe("changesHref", () => {
  it("spells the base the way the site names a branch, and leaves out an unknown head", () => {
    expect(changesHref("https://acme.github.io/shop", "origin/main", "")).toBe("https://acme.github.io/shop/changes?base=main");
    expect(changesHref("", "main", "x")).toBe("");
  });
});

describe("locate", () => {
  const files = [
    { path: "data/adr.json", text: '{\n  "adrs": [\n    { "id": "portolan.0001" }\n  ]\n}\n' },
    { path: "examples/shop/portolan/domain.json", text: '{"contexts":[{"id":"shop","services":[{"id":"shop.order"}]}]}' },
  ];

  it("finds the fragment and line that declares the id", () => {
    expect(locate("shop.order", files)).toEqual({ uri: "examples/shop/portolan/domain.json", line: 1 });
    expect(locate("portolan.0001", files)).toEqual({ uri: "data/adr.json", line: 3 });
  });

  // `shop.order` must not match `shop-order` or `shop.orders`: the id is a
  // whole string, and its dots are dots.
  it("takes the id whole", () => {
    expect(locate("shop.orde", files)).toEqual({ uri: "portolan.json", line: 1 });
    expect(locate("shop_order", files)).toEqual({ uri: "portolan.json", line: 1 });
  });

  it("falls back to the manifest for what no working-tree source declares", () => {
    expect(locate("gone.service", files)).toEqual({ uri: "portolan.json", line: 1 });
  });
});

describe("machine formats", () => {
  const changes = [
    { kind: "event.removed", severity: "breaking", where: "shop.order", summary: "event is gone" },
    { kind: "owner.added", severity: "change", where: "shop.cart", summary: "owner changed" },
  ];

  it("parses a ref, format and output in either option spelling", () => {
    expect(parseArgs(["main", "--format=json", "--output", "report.json"])).toEqual({
      ref: "main", format: "json", output: "report.json", site: "", head: "",
    });
    expect(parseArgs(["--site", "https://acme.github.io/shop", "--head=feat/x"])).toMatchObject({
      site: "https://acme.github.io/shop", head: "feat/x",
    });
    expect(() => parseArgs(["--site"])).toThrow("--site needs a value");
  });

  it("anchors every SARIF result at the fragment that declares it", () => {
    const files = [{ path: "examples/shop/portolan/domain.json", text: '{\n  "id": "shop.cart"\n}' }];
    const report = JSON.parse(renderSarif("main", changes, files));
    const [gone, owned] = report.runs[0].results;

    expect(gone.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: "portolan.json", uriBaseId: "%SRCROOT%" },
      region: { startLine: 1, startColumn: 1 },
    });
    expect(owned.locations[0].physicalLocation.artifactLocation.uri).toBe("examples/shop/portolan/domain.json");
    expect(owned.locations[0].physicalLocation.region.startLine).toBe(2);
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
