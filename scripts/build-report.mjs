// The last generator run, for the Settings page.
//
// Unlike catalog fragments this is deliberately not committed: elapsed time
// and the wall clock are observations of one run, not reproducible catalog
// facts. Vite reduces this file again before it reaches the browser.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeOutputFile } from "./output-path.mjs";

export const BUILD_REPORT_DIR = ".portolan";
export const BUILD_REPORT_NAME = "build-report.json";

export function createBuildReport({
  mode,
  manifestSha256,
  now = Date.now(),
}) {
  return {
    version: 1,
    mode,
    manifestSha256,
    status: "running",
    startedAt: new Date(now).toISOString(),
    finishedAt: "",
    durationMs: 0,
    steps: [],
  };
}

export function addBuildStep(report, step) {
  report.steps.push({ ordinal: report.steps.length, ...step });
}

export function finishBuildReport(report, status, now = Date.now()) {
  report.status = status;
  report.finishedAt = new Date(now).toISOString();
  report.durationMs = Math.max(0, now - Date.parse(report.startedAt));
  return report;
}

export function writeBuildReport(
  report,
  out = BUILD_REPORT_DIR,
  name = BUILD_REPORT_NAME,
) {
  writeOutputFile(out, name, `${JSON.stringify(report, null, 2)}\n`);
}

export function readBuildReport(
  out = BUILD_REPORT_DIR,
  name = BUILD_REPORT_NAME,
) {
  try {
    return JSON.parse(readFileSync(join(out, name), "utf8"));
  } catch {
    return null;
  }
}
