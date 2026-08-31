import { describe, expect, it } from "vitest";
import {
  buildHref,
  buildLabel,
  buildTitle,
  type BuildInfo,
} from "./build-info";

const CI: BuildInfo = {
  commit: "4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  shortCommit: "4f1c9ae",
  branch: "main",
  builtAt: "2026-08-29T09:14:22Z",
  commitUrl:
    "https://gitlab.com/acme/portolan/-/commit/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  buildUrl: "https://gitlab.com/acme/portolan/-/pipelines/17390211",
  buildNumber: "128",
  dirty: false,
};

const UNKNOWN: BuildInfo = {
  commit: "",
  shortCommit: "",
  branch: "",
  builtAt: "",
  commitUrl: "",
  buildUrl: "",
  buildNumber: "",
  dirty: false,
};

describe("buildHref", () => {
  it("opens the commit the stamp names", () => {
    expect(buildHref(CI)).toBe(CI.commitUrl);
  });

  it("settles for the pipeline when the forge is unknown", () => {
    expect(buildHref({ ...CI, commitUrl: "" })).toBe(CI.buildUrl);
  });

  it("is null when there is nowhere to go", () => {
    expect(buildHref(UNKNOWN)).toBeNull();
  });
});

describe("buildLabel", () => {
  it("reads as the commit, not the build number, even on CI", () => {
    expect(buildLabel(CI)).toBe("4f1c9ae");
  });

  it("marks a tree that was dirty when it was built", () => {
    expect(buildLabel({ ...CI, dirty: true })).toBe("4f1c9ae+");
  });

  it("falls back to the build number when there is no commit", () => {
    expect(buildLabel({ ...UNKNOWN, buildNumber: "128" })).toBe("#128");
  });

  it("says dev rather than nothing when git knew nothing", () => {
    expect(buildLabel(UNKNOWN)).toBe("dev");
  });
});

describe("buildTitle", () => {
  it("spells out every field that has an answer", () => {
    expect(buildTitle(CI)).toBe(
      "commit 4f1c9ae · branch main · build #128 · built 2026-08-29 09:14:22Z",
    );
  });

  it("drops the parts it cannot fill", () => {
    expect(buildTitle(UNKNOWN)).toBe("built at an unrecorded time");
  });
});
