import { describe, expect, it } from "vitest";
import type { BuildInfo } from "./build-info";
import type { RepoPin } from "../catalog";
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

const shop = { repo: "github.com/acme/shop" };

const PINS: RepoPin[] = [
  { repo: "github.com/acme/shop", commit: "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0" },
];

describe("sourceHref", () => {
  const auth = { repo: "github.com/shortlink-org/portolan" };

  it("links a file at the built commit, on the line", () => {
    expect(sourceHref("examples/auth/internal/x.go:20", auth, [], GH)).toBe(
      "https://github.com/shortlink-org/portolan/blob/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/examples/auth/internal/x.go#L20",
    );
    expect(sourceHref("examples/auth/README.md", auth, [], GH)).toMatch(/README\.md$/);
  });

  it("uses GitLab's /-/blob/ when that is the forge", () => {
    const gl = { ...GH, repoUrl: "https://gitlab.com/acme/portolan" };
    expect(sourceHref("a/b.go:1", { repo: "gitlab.com/acme/portolan" }, [], gl)).toBe(
      "https://gitlab.com/acme/portolan/-/blob/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/a/b.go#L1",
    );
  });

  it("does not link a service that lives in another repository, unpinned", () => {
    expect(sourceHref("internal/oms/app/checkout.go:104", { repo: "github.com/acme/shop" }, [], GH)).toBeNull();
  });

  it("links a service in another repository at the commit it was fetched at", () => {
    expect(sourceHref("services/oms/app/checkout.go:104", shop, PINS, GH)).toBe(
      "https://github.com/acme/shop/blob/c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0/services/oms/app/checkout.go#L104",
    );
  });

  it("removes the local vendoring prefix from an external source", () => {
    expect(sourceHref("vendor/repos/acme/shop/services/oms/app/checkout.go:104", shop, PINS, GH)).toBe(
      "https://github.com/acme/shop/blob/c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0/services/oms/app/checkout.go#L104",
    );
  });

  it("reads a pin however the repository was spelled", () => {
    const pins: RepoPin[] = [{ repo: "https://GitHub.com/acme/shop.git", commit: "abc1234" }];
    expect(sourceHref("services/oms/app/checkout.go", shop, pins, GH)).toBe(
      "https://github.com/acme/shop/blob/abc1234/services/oms/app/checkout.go",
    );
  });

  it("prefers the build over a pin naming the repository this was built from", () => {
    const pins: RepoPin[] = [{ repo: "github.com/shortlink-org/portolan", commit: "0000000" }];
    expect(sourceHref("examples/auth/internal/x.go:20", auth, pins, GH)).toContain(GH.commit);
  });

  it("does not link a pin with no commit", () => {
    expect(sourceHref("services/oms/app/checkout.go", shop, [{ repo: "github.com/acme/shop", commit: "" }], GH)).toBeNull();
  });

  it("does not link when the build does not know its repository", () => {
    expect(sourceHref("examples/auth/internal/x.go:20", auth, [], { ...GH, repoUrl: "" })).toBeNull();
  });

  it("does not link a place that is not a path", () => {
    expect(sourceHref("trace 9f2c1a../span 04", auth, [], GH)).toBeNull();
  });

  it("links a service that names no repository, since there is only the one", () => {
    expect(sourceHref("docs/x.md", { repo: "" }, [], GH)).toMatch(/\/docs\/x\.md$/);
  });
});

describe("treeHref", () => {
  it("opens the service's directory", () => {
    expect(treeHref("examples/auth", { repo: "github.com/shortlink-org/portolan" }, [], GH)).toBe(
      "https://github.com/shortlink-org/portolan/tree/4f1c9ae0c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6/examples/auth",
    );
  });

  it("opens a vendored service's directory in the repository it came from", () => {
    expect(treeHref("services/oms", shop, PINS, GH)).toBe(
      "https://github.com/acme/shop/tree/c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0/services/oms",
    );
  });

  it("removes the local vendoring prefix from an external tree", () => {
    expect(treeHref("vendor/repos/acme/shop/services/oms", shop, PINS, GH)).toBe(
      "https://github.com/acme/shop/tree/c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0/services/oms",
    );
  });
});
