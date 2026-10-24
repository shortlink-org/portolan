import { describe, expect, it } from "vitest";
import type { ChangeSpec } from "../catalog";
import { index } from "../data";
import { knownSpecPaths, referencesIn, resolveSpecReference } from "./spec-references";

const spec: ChangeSpec = {
  id: "test-change", slug: "test-change", title: "Test change", format: "openspec", lifecycle: "draft",
  source: "openspec/changes/test-change/proposal.md",
  artifacts: [{ kind: "proposal", path: "openspec/changes/test-change/proposal.md", body: "" }],
  requirements: [{ id: "test-change/core/exact-links", title: "Exact links", text: "", source: "openspec/changes/test-change/spec.md:3", scenarios: [] }],
  tasks: [{ id: "4.1", title: "Parser", done: false, source: "openspec/changes/test-change/tasks.md:4" }],
};
const context = { spec, index, knownPaths: knownSpecPaths(spec) };

describe("exact specification references", () => {
  it("resolves URLs, catalog IDs, typed slugs, same-change IDs and known source lines", () => {
    expect(resolveSpecReference("https://example.com/a", context)).toMatchObject({ status: "resolved", kind: "url" });
    expect(resolveSpecReference("portolan.host", context)).toMatchObject({ status: "resolved", kind: "catalog-id", href: "/c/portolan/host" });
    expect(resolveSpecReference("spec:automate-sdd-workflow", context)).toMatchObject({ status: "resolved", kind: "typed-slug", href: "/specs/automate-sdd-workflow" });
    expect(resolveSpecReference("test-change/core/exact-links", context)).toMatchObject({ status: "resolved", kind: "requirement" });
    expect(resolveSpecReference("4.1", context)).toMatchObject({ status: "resolved", kind: "task" });
    expect(resolveSpecReference("openspec/changes/test-change/spec.md:3", context)).toMatchObject({ status: "resolved", kind: "source" });
  });

  it("retains syntactically exact unresolved references and ignores ordinary prose", () => {
    expect(resolveSpecReference("flow:no-such-flow", context)).toMatchObject({ status: "unresolved", kind: "typed-slug" });
    expect(resolveSpecReference("missing/file.ts:9", context)).toMatchObject({ status: "unresolved", kind: "source" });
    expect(resolveSpecReference("unknown.component", context)).toMatchObject({ status: "unresolved", kind: "source" });
    expect(resolveSpecReference("Cart service", context)).toBeNull();
  });

  it("only scans explicit inline-code tokens", () => {
    expect(referencesIn("Cart service resembles portolan.host, but only `portolan.host` is exact.", context)).toEqual([
      expect.objectContaining({ raw: "portolan.host", status: "resolved", kind: "catalog-id" }),
    ]);
  });
});
