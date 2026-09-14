import { describe, expect, it } from "vitest";
import { validateCatalog } from "../catalog";
import type { Catalog, WorkItemLink } from "../catalog";
import { mergeCatalogs } from "../merge";
import { filterCatalogForProfile } from "../catalog-profile";
import { relatedWorkItems } from "./work-items";

const base: Catalog = { generatedAt: "2026-09-14T00:00:00Z", commit: "abc1234", contexts: [{ id: "shop", slug: "shop", name: "Shop", summary: "", services: [] }], defs: {}, adrs: [], flows: [{ id: "flow.one", slug: "one", name: "One", summary: "", owner: "shop", participants: [], steps: [] }] };
const item = { id: "team:RT-101", tracker: "team", provider: "youtrack", key: "RT-101", url: "https://tasks.example.com/issue/RT-101" };
const commit = { repository: "https://github.com/acme/shop", sha: "a".repeat(40), subject: "RT-101: toolbar", author: "Alex", date: "2026-09-14T00:00:00Z", paths: ["src/toolbar.ts"] };
const link: WorkItemLink = { workItem: item.id, target: { kind: "flow", id: "flow.one" }, basis: "source-file", commits: [commit] };
const withWork = (): Catalog => structuredClone({ ...base, workItems: [item], workItemLinks: [link] });

describe("work item catalog contract", () => {
  it("accepts both old catalogs and explicit links with no Git commit", () => {
    expect(validateCatalog(base)).toBe(base);
    const catalog = withWork();
    expect(validateCatalog(catalog)).toBe(catalog);
    catalog.workItemLinks = [{ ...link, basis: "declared", commits: [] }];
    expect(() => validateCatalog(catalog)).not.toThrow();
  });
  it("unions evidence and optional task metadata without duplicating tasks or mutating sources", () => {
    const a = withWork();
    const b: Catalog = { ...base, contexts: [], flows: [], workItems: [{ ...item, title: "Toolbar" }], workItemLinks: [{ ...link, commits: [{ ...commit, paths: ["src/other.ts"] }] }] };
    const result = mergeCatalogs([{ path: "a", catalog: a }, { path: "b", catalog: b }]);
    expect(result.conflicts).toEqual([]);
    expect(result.catalog.workItemLinks![0]!.commits[0]!.paths).toEqual(["src/other.ts", "src/toolbar.ts"]);
    expect(a.workItemLinks![0]!.commits[0]!.paths).toEqual(["src/toolbar.ts"]);
    expect(relatedWorkItems(result.catalog, link.target)).toHaveLength(1);
    expect(result.catalog.workItems![0]!.title).toBe("Toolbar");
    expect(() => validateCatalog(result.catalog)).not.toThrow();
  });
  it("rejects dangling tasks/targets, unsafe URLs and unsupported derived evidence", () => {
    for (const mutate of [
      (c: Catalog) => { c.workItems![0]!.url = "javascript:alert(1)"; },
      (c: Catalog) => { c.workItemLinks![0]!.workItem = "missing"; },
      (c: Catalog) => { c.workItemLinks![0]!.target = { kind: "step", flow: "flow.one", id: "s1" }; },
      (c: Catalog) => { c.workItemLinks![0]!.commits = []; },
      (c: Catalog) => { c.workItemLinks![0]!.commits[0]!.sha = "HEAD"; },
      (c: Catalog) => { c.workItemLinks![0]!.commits[0]!.date = "not a date"; },
      (c: Catalog) => { c.workItemLinks![0]!.commits.push(structuredClone(commit)); },
      (c: Catalog) => { c.workItems![0]!.title = {} as never; },
    ]) { const catalog = withWork(); mutate(catalog); expect(() => validateCatalog(catalog)).toThrow(); }
  });
  it("keeps tracker identities separate and removes out-of-profile task metadata", () => {
    const catalog = withWork();
    catalog.workItems!.push({ ...item, id: "other:RT-101", tracker: "other" });
    catalog.workItemLinks!.push({ ...link, workItem: "other:RT-101" });
    expect(relatedWorkItems(catalog, link.target)).toHaveLength(2);
    const selected = filterCatalogForProfile(catalog, { id: "other", title: "Other", sources: [], contexts: ["other"], projects: [] });
    expect(selected.workItems).toEqual([]);
    expect(selected.workItemLinks).toEqual([]);
  });
});
