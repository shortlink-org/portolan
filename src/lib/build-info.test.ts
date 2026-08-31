import { describe, expect, it } from "vitest";
import {
  buildLabel,
  buildTitle,
  commitUrl,
  runUrl,
  type BuildInfo,
} from "./build-info";

const CI: BuildInfo = {
  commit: "4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  shortCommit: "4f1c9ae",
  branch: "main",
  builtAt: "2026-08-29T09:14:22Z",
  repo: "shortlink-org/portolan",
  server: "https://github.com",
  runNumber: "128",
  runId: "17390211",
  dirty: false,
};

const UNKNOWN: BuildInfo = {
  commit: "",
  shortCommit: "",
  branch: "",
  builtAt: "",
  repo: "",
  server: "",
  runNumber: "",
  runId: "",
  dirty: false,
};

describe("runUrl", () => {
  it("points at the run that produced the bundle", () => {
    expect(runUrl(CI)).toBe(
      "https://github.com/shortlink-org/portolan/actions/runs/17390211",
    );
  });

  it("is null for a build CI did not make", () => {
    expect(runUrl({ ...CI, runId: "", runNumber: "" })).toBeNull();
    expect(runUrl(UNKNOWN)).toBeNull();
  });
});

describe("commitUrl", () => {
  it("uses the full sha, which is what GitHub resolves", () => {
    expect(commitUrl(CI)).toBe(
      `https://github.com/shortlink-org/portolan/commit/${CI.commit}`,
    );
  });

  it("is null without a repo to hang it on", () => {
    expect(commitUrl({ ...CI, repo: "" })).toBeNull();
  });
});

describe("buildLabel", () => {
  it("reads as the build number when there was a build", () => {
    expect(buildLabel(CI)).toBe("#128");
  });

  it("falls back to the commit, marking a dirty tree", () => {
    const local = { ...CI, runNumber: "", runId: "" };
    expect(buildLabel(local)).toBe("4f1c9ae");
    expect(buildLabel({ ...local, dirty: true })).toBe("4f1c9ae+");
  });

  it("says dev rather than nothing when git knew nothing", () => {
    expect(buildLabel(UNKNOWN)).toBe("dev");
  });
});

describe("buildTitle", () => {
  it("spells out every field that has an answer", () => {
    expect(buildTitle(CI)).toBe(
      "build #128 · commit 4f1c9ae · branch main · built 2026-08-29 09:14:22Z",
    );
  });

  it("drops the parts it cannot fill", () => {
    expect(buildTitle(UNKNOWN)).toBe("built at an unrecorded time");
  });
});
