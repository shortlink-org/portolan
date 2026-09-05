import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addBuildStep,
  createBuildReport,
  finishBuildReport,
  writeBuildReport,
} from "./build-report.mjs";

describe("build report", () => {
  it("records one run without making it a generated catalog artifact", () => {
    const report = createBuildReport({
      mode: "check",
      manifestSha256: "abc",
      now: Date.parse("2026-09-05T00:00:00Z"),
    });
    addBuildStep(report, {
      phase: "extract",
      plugin: "domain",
      input: "services/auth",
      output: "services/auth/portolan",
      status: "up-to-date",
      durationMs: 42,
      fileCount: 1,
      changedCount: 0,
      files: ["services/auth/portolan/domain.json"],
    });
    finishBuildReport(
      report,
      "ok",
      Date.parse("2026-09-05T00:00:01Z"),
    );

    expect(report.durationMs).toBe(1000);
    expect(report.steps[0]?.ordinal).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), "portolan-report-"));
    writeBuildReport(report, dir);
    expect(JSON.parse(readFileSync(join(dir, "build-report.json"), "utf8")))
      .toEqual(report);
  });
});
