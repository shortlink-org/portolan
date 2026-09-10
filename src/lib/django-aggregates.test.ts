import { describe, expect, it } from "vitest";
import { djangoAggregateCandidates } from "./django-aggregates";
import { warningDiagnostic } from "./warnings";
import { publicSetupFrom } from "./setup-info";

describe("Django aggregate evidence", () => {
  const candidates = { app: "billing.records", models: Array.from({ length: 29 }, (_, index) => ({ name: `Record${index}`, path: "source/billing/records/models.py", line: index + 1 })) };
  const message = `source/billing/records: no model called Records, and 29 models to choose from: name the root in the aggregates option; aggregate candidates: ${JSON.stringify(candidates)}`;

  it("retains all candidates beyond the public warning text limit", () => {
    const warning = warningDiagnostic({ plugin: "django-domain", message });
    expect(warning.aggregateCandidates).toEqual(candidates);
    expect(warning.message).not.toContain("aggregate candidates:");
    const setup = publicSetupFrom({ sources: [], extract: [{ plugin: "django-domain", in: "source", out: "data" }] }, {
      version: 1, manifestSha256: "current", mode: "write", status: "ok", startedAt: "2026-09-10T00:00:00Z", finishedAt: "2026-09-10T00:00:01Z", durationMs: 1000,
      steps: [{ ordinal: 0, phase: "extract", plugin: "django-domain", input: "source", output: "data", status: "written", durationMs: 10, fileCount: 1, changedCount: 1, files: ["data/domain.json"], warnings: [message], diagnostics: [{ ...warning, message, count: 1, project: "", phase: "extract" }] }],
    }, "current");
    expect(setup.run?.steps[0]?.diagnostics[0]?.aggregateCandidates).toEqual(candidates);
    expect(setup.run?.steps[0]?.diagnostics[0]?.message.length).toBeLessThan(500);
  });

  it("leaves old warnings usable and rejects malformed or duplicate choices", () => {
    expect(djangoAggregateCandidates("legacy warning")).toBeNull();
    expect(djangoAggregateCandidates("; aggregate candidates: {broken")).toBeNull();
    for (const value of [{ app: "../records", models: candidates.models }, { ...candidates, models: [candidates.models[0], candidates.models[0]] }, { ...candidates, models: [{ name: "Record", path: "models.py", line: 0 }] }]) {
      expect(djangoAggregateCandidates(`; aggregate candidates: ${JSON.stringify(value)}`)).toBeNull();
    }
  });
});
