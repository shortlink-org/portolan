import { describe, expect, it } from "vitest";
import type { BuildInfo } from "./build-info";
import { artifactFilename } from "./export-file";

const info = (values: Partial<BuildInfo>): BuildInfo => ({
  commit: "",
  shortCommit: "",
  branch: "",
  builtAt: "",
  commitUrl: "",
  buildUrl: "",
  buildNumber: "",
  dirty: false,
  repoUrl: "",
  ...values,
});

describe("artifactFilename", () => {
  it("prefers the commit and sanitizes the artifact name", () => {
    expect(artifactFilename("checkout / happy path", "svg", info({ shortCommit: "abc1234", branch: "main" }))).toBe(
      "checkout-happy-path-abc1234.svg",
    );
  });

  it("uses a sanitized branch and safe fallbacks", () => {
    expect(artifactFilename("///", ".png", info({ branch: "feature/export v2" }))).toBe(
      "artifact-feature-export-v2.png",
    );
  });
});
