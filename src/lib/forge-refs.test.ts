import { describe, expect, it } from "vitest";
import type { ForgeRef } from "./github-catalog";
import { compareVersionsDesc, findRef, parseVersion, sortRefs } from "./forge-refs";

const ref = (name: string, kind: ForgeRef["kind"] = "branch"): ForgeRef => ({
  name, kind, commit: "a".repeat(40), protected: false,
});

describe("parseVersion", () => {
  it("reads a version out of the usual tag spellings", () => {
    expect(parseVersion("v1.2.3")).toEqual({ parts: [1, 2, 3], pre: "" });
    expect(parseVersion("release-2.0")).toEqual({ parts: [2, 0], pre: "" });
    expect(parseVersion("1.0.0-rc.1")).toEqual({ parts: [1, 0, 0], pre: "rc.1" });
    expect(parseVersion("nightly")).toBeNull();
  });
});

describe("compareVersionsDesc", () => {
  it("puts the newest first and a prerelease before its release", () => {
    const sorted = ["v1.2.0", "v1.10.0", "v1.2.0-rc.1", "v1.9.3"].sort(compareVersionsDesc);
    expect(sorted).toEqual(["v1.10.0", "v1.9.3", "v1.2.0", "v1.2.0-rc.1"]);
  });

  it("keeps tags that are not versions after those that are", () => {
    expect(["nightly", "v0.1.0", "archive"].sort(compareVersionsDesc)).toEqual(["v0.1.0", "nightly", "archive"]);
  });
});

describe("sortRefs", () => {
  it("leads with the current branch and main, then names, then tags newest first", () => {
    const sorted = sortRefs([
      ref("v1.0.0", "tag"), ref("feature/b"), ref("main"), ref("v2.0.0", "tag"), ref("feature/a"), ref("release"),
    ], "release");
    expect(sorted.map((r) => r.name)).toEqual(["release", "main", "feature/a", "feature/b", "v2.0.0", "v1.0.0"]);
  });

  it("does not let a tag named like the current branch jump the queue", () => {
    const sorted = sortRefs([ref("main", "tag"), ref("dev"), ref("main")], "main");
    expect(sorted.map((r) => r.kind)).toEqual(["branch", "branch", "tag"]);
  });
});

describe("findRef", () => {
  it("prefers the branch when a tag shares its name", () => {
    const refs = [ref("v1", "tag"), ref("v1")];
    expect(findRef(refs, "v1")?.kind).toBe("branch");
    expect(findRef([ref("v1", "tag")], "v1")?.kind).toBe("tag");
    expect(findRef(refs, "v2")).toBeUndefined();
  });
});
