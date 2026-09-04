import { describe, expect, it } from "vitest";
import type { BuildInfo } from "./build-info";
import { sourceHref, splitLine, treeHref } from "./source-link";

const GH: BuildInfo = {
  commit: "4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  shortCommit: "4f1c9ae",
  branch: "main",
  builtAt: "",
  commitUrl: "",
  buildUrl: "",
  buildNumber: "",
  dirty: false,
  repoUrl: "https://github.com/shortlink-org/portolan",
};

describe("splitLine", () => {
  it("takes the line off a file:line", () => {
    expect(splitLine("internal/oms/app/checkout.go:104")).toEqual({
      path: "internal/oms/app/checkout.go",
      line: 104,
    });
  });
  it("leaves anything else whole", () => {
    expect(splitLine("trace 9f2c1a../span 04")).toEqual({ path: "trace 9f2c1a../span 04", line: null });
    expect(splitLine("services/oms/test/e2e/checkout_test.go").line).toBeNull();
  });
});

describe("sourceHref", () => {
  const auth = { repo: "github.com/shortlink-org/portolan" };

  it("links a file at the built commit, on the line", () => {
    expect(sourceHref("examples/auth/internal/x.go:20", auth, GH)).toBe(
      "https://github.com/shortlink-org/portolan/blob/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/examples/auth/internal/x.go#L20",
    );
    expect(sourceHref("examples/auth/README.md", auth, GH)).toMatch(/README\.md$/);
  });

  it("uses GitLab's /-/blob/ when that is the forge", () => {
    const gl = { ...GH, repoUrl: "https://gitlab.com/acme/portolan" };
    expect(sourceHref("a/b.go:1", { repo: "gitlab.com/acme/portolan" }, gl)).toBe(
      "https://gitlab.com/acme/portolan/-/blob/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/a/b.go#L1",
    );
  });

  it("does not link a service that lives in another repository", () => {
    expect(sourceHref("internal/oms/app/checkout.go:104", { repo: "github.com/acme/shop" }, GH)).toBeNull();
  });

  it("does not link when the build does not know its repository", () => {
    expect(sourceHref("examples/auth/internal/x.go:20", auth, { ...GH, repoUrl: "" })).toBeNull();
  });

  it("does not link a place that is not a path", () => {
    expect(sourceHref("trace 9f2c1a../span 04", auth, GH)).toBeNull();
  });

  it("links a service that names no repository, since there is only the one", () => {
    expect(sourceHref("docs/x.md", { repo: "" }, GH)).toMatch(/\/docs\/x\.md$/);
  });
});

describe("treeHref", () => {
  it("opens the service's directory", () => {
    expect(treeHref("examples/auth", { repo: "github.com/shortlink-org/portolan" }, GH)).toBe(
      "https://github.com/shortlink-org/portolan/tree/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/examples/auth",
    );
  });
});
