import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { djangoAggregateProposals, saveDjangoAggregates } from "./local-api.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "portolan-aggregates-")); roots.push(root);
  const manifest = { sources: ["data/*.json"], extract: ["one", "two"].map((name) => ({ plugin: "django-domain", in: name, out: `data/${name}`, options: { context: name, service: name, aggregates: { existing: "Existing" }, apps: ["billing.records"] } })) };
  const text = JSON.stringify(manifest);
  writeFileSync(join(root, "portolan.json"), text);
  const message = `billing/records: no model called Records, and 2 models to choose from: name the root in the aggregates option; aggregate candidates: ${JSON.stringify({ app: "billing.records", models: [{ name: "Entry", path: "billing/records/models.py", line: 1 }, { name: "Audit", path: "billing/records/models.py", line: 10 }] })}`;
  const report = { status: "ok", manifestSha256: createHash("sha256").update(text).digest("hex"), steps: manifest.extract.map((step) => ({ phase: "extract", plugin: step.plugin, input: step.in, output: step.out, warnings: [message] })) };
  mkdirSync(join(root, ".portolan")); writeFileSync(join(root, ".portolan/build-report.json"), JSON.stringify(report));
  return { root, manifest, report };
}

describe("saving Django aggregate roots", () => {
  it("targets the precise step and dotted app, preserving unrelated options", () => {
    const { root, manifest } = fixture();
    const proposals = djangoAggregateProposals(root);
    expect(proposals.stale).toBe(false);
    expect(proposals.proposals).toHaveLength(2);
    saveDjangoAggregates(root, { revision: proposals.revision, selections: [{ id: "1:billing.records", model: "Entry" }] });
    const saved = JSON.parse(readFileSync(join(root, "portolan.json"), "utf8"));
    expect(saved.extract[0]).toEqual(manifest.extract[0]);
    expect(saved.extract[1].options).toEqual({ ...manifest.extract[1].options, aggregates: { existing: "Existing", "billing.records": "Entry" } });
    expect(djangoAggregateProposals(root).stale).toBe(true);
  });

  it("saves a batch atomically and rejects forged, duplicate, or stale choices", () => {
    const { root } = fixture();
    const { revision } = djangoAggregateProposals(root);
    const original = readFileSync(join(root, "portolan.json"), "utf8");
    for (const selections of [[], [{ id: "0:billing.records", model: "Proxy" }], [{ id: "no-such-step", model: "Entry" }], [{ id: "0:billing.records", model: "Entry" }, { id: "1:billing.records", model: "Invalid" }], [{ id: "0:billing.records", model: "Entry" }, { id: "0:billing.records", model: "Audit" }]]) {
      expect(() => saveDjangoAggregates(root, { revision, selections })).toThrow();
      expect(readFileSync(join(root, "portolan.json"), "utf8")).toBe(original);
    }
    const selections = [{ id: "0:billing.records", model: "Entry" }, { id: "1:billing.records", model: "Audit" }];
    expect(() => saveDjangoAggregates(root, { revision: "old", selections })).toThrow(/changed/);
    expect(saveDjangoAggregates(root, { revision, selections })).toEqual({ saved: 2 });
    expect(() => saveDjangoAggregates(root, { revision, selections })).toThrow(/changed/);
  });

  it("requires fresh report evidence and refuses ambiguous step bindings", () => {
    const { root, manifest, report } = fixture();
    manifest.extract.push(manifest.extract[0]);
    writeFileSync(join(root, "portolan.json"), JSON.stringify(manifest));
    expect(djangoAggregateProposals(root).proposals.map((p) => p.id)).toEqual(["1:billing.records"]);
    expect(djangoAggregateProposals(root).stale).toBe(true);
    report.steps = [];
    writeFileSync(join(root, ".portolan/build-report.json"), JSON.stringify(report));
    expect(djangoAggregateProposals(root).proposals).toEqual([]);
  });
});
