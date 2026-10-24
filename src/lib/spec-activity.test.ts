import { describe, expect, it } from "vitest";
import type { ChangeSpec } from "../catalog";
import { projectSpecActivity, sortSpecActivity } from "./spec-activity";

const spec: ChangeSpec = {
  id: "checkout", slug: "checkout", title: "Checkout", format: "openspec", lifecycle: "implementing",
  source: "openspec/changes/checkout", artifacts: [], requirements: [],
  tasks: [{ id: "1.1", title: "Ship it", done: true, source: "tasks.md:3" }],
};

describe("spec activity", () => {
  it("orders by timestamp descending, then kind and stable key", () => {
    const ordered = sortSpecActivity([
      { key: "z", kind: "task.completed", timestamp: "2026-01-01T00:00:00Z", summary: "z", evidence: "catalog-diff" },
      { key: "b", kind: "git.changed", timestamp: "2026-01-01T00:00:00Z", summary: "b", evidence: "git-history" },
      { key: "a", kind: "git.changed", timestamp: "2026-01-01T00:00:00Z", summary: "a", evidence: "git-history" },
      { key: "new", kind: "git.changed", timestamp: "2026-02-01T00:00:00Z", summary: "new", evidence: "git-history" },
    ]);
    expect(ordered.map((event) => event.key)).toEqual(["new", "a", "b", "z"]);
  });

  it("keeps author intent, Git history, diff transitions, and path impact distinct", () => {
    const previous = { ...spec, lifecycle: "planned" as const, tasks: [{ ...spec.tasks[0]!, done: false }] };
    const events = projectSpecActivity({
      spec,
      previous,
      history: [{ source: "tasks.md", status: "available", repository: "https://github.com/acme/repo", first: { commit: "abc", author: "Ada", date: "2026-01-01T00:00:00Z" }, latest: { commit: "def", author: "Lin", date: "2026-02-01T00:00:00Z" } }],
      impact: [{ path: "src/pay.ts", repository: "acme/repo", level: "service", service: "payments", servicePath: "src" }],
      hrefForCatalogId: (id) => `/id/${id}`,
    });
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["git.introduced", "git.changed", "spec.lifecycle", "task.completed", "path.impact"]));
    expect(events.find((event) => event.kind === "task.completed")?.evidence).toBe("catalog-diff");
    expect(events.find((event) => event.kind === "path.impact")?.architecture?.href).toBe("/id/payments");
  });

  it("projects current source state as author intent when no comparison exists", () => {
    const events = projectSpecActivity({ spec });
    expect(events.map(({ kind, evidence }) => [kind, evidence])).toEqual([
      ["spec.lifecycle", "author-intent"],
      ["task.completed", "author-intent"],
    ]);
  });
});
