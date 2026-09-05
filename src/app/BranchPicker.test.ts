import { describe, expect, it } from "vitest";
import { branchCompareHref } from "../lib/branch-compare";
import type { BuildInfo } from "../lib/build-info";

const BUILD: BuildInfo = {
  commit: "abc",
  shortCommit: "abc",
  branch: "feature/catalog",
  builtAt: "",
  commitUrl: "",
  buildUrl: "",
  buildNumber: "",
  dirty: false,
  repoUrl: "https://github.com/acme/portolan/",
};

describe("branchCompareHref", () => {
  it("builds a GitHub comparison without losing slashes in branch names", () => {
    expect(branchCompareHref("main", "feature/catalog", BUILD)).toBe(
      "https://github.com/acme/portolan/compare/main...feature%2Fcatalog",
    );
  });

  it("uses GitLab's namespaced comparison route", () => {
    expect(
      branchCompareHref("main", "feature", {
        ...BUILD,
        repoUrl: "https://gitlab.com/acme/portolan",
      }),
    ).toBe("https://gitlab.com/acme/portolan/-/compare/main...feature");
  });

  it("does not offer a comparison for the same branch", () => {
    expect(branchCompareHref("main", "main", BUILD)).toBeNull();
  });
});
