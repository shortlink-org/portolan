import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import type { Catalog, Flow, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { alignSteps, diffBranch, mainEntities, sameEntity, stateAgainstMain } from "./branch-draft";

/**
 * Every case starts from the frozen estate as the base and edits one thing on
 * the branch, so what the diff reports is that edit and nothing more.
 */
function branched(edit: (c: Catalog) => void): Catalog {
  const branch = JSON.parse(JSON.stringify(catalog)) as Catalog;
  edit(branch);
  return branch;
}

const summary = (base: Catalog, branch: Catalog) => diffBranch(base, branch).map((e) => `${e.change} ${e.kind} ${e.id}`);

function firstEvent(c: Catalog) {
  for (const context of c.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        if (aggregate.events[0]) return { context, service, aggregate, event: aggregate.events[0] };
      }
    }
  }
  throw new Error("the estate has no event");
}

function longFlow(c: Catalog): Flow {
  const flow = c.flows.find((f) => walkSteps(f.steps).length >= 4);
  if (!flow) throw new Error("the estate has no flow of four steps");
  return flow;
}

describe("diffBranch", () => {
  it("reports nothing for a branch that changed nothing", () => {
    expect(diffBranch(catalog, catalog)).toEqual([]);
  });

  it("does not count where a thing was read from as a change", () => {
    const branch = branched((c) => {
      const { event } = firstEvent(c);
      event.versions[0]!.source = "somewhere/else.go:999";
      c.commit = "0000000";
      c.generatedAt = "2030-01-01T00:00:00Z";
    });
    expect(diffBranch(catalog, branch)).toEqual([]);
  });

  it("reports a field added to an event as that event changed, and only that", () => {
    const branch = branched((c) => {
      const { event } = firstEvent(c);
      event.versions[event.versions.length - 1]!.fields.push({ name: "method", type: "string", doc: "" });
    });
    const { event, context, service, aggregate } = firstEvent(catalog);
    const changes = diffBranch(catalog, branch);
    expect(summary(catalog, branch)).toEqual([`changed event ${event.id}`]);
    expect(changes[0]!.place).toEqual({ context: context.id, service: service.slug, aggregate: aggregate.slug });
    expect(changes[0]!.base).toBeDefined();
    expect(changes[0]!.branch).toBeDefined();
  });

  it("reports an event the branch adds on its own, not its aggregate and service too", () => {
    const branch = branched((c) => {
      const { aggregate } = firstEvent(c);
      aggregate.events.push({ id: `${aggregate.id}.CouponApplied`, slug: "coupon-applied", name: "CouponApplied", versions: [{ version: "v1", doc: "", source: "", fields: [] }], consumers: [] });
    });
    const { aggregate } = firstEvent(catalog);
    expect(summary(catalog, branch)).toEqual([`added event ${aggregate.id}.CouponApplied`]);
  });

  it("reports a flow the branch removes, with the version it had", () => {
    const gone = catalog.flows[0]!;
    const branch = branched((c) => {
      c.flows = c.flows.filter((f) => f.id !== gone.id);
    });
    const changes = diffBranch(catalog, branch);
    expect(summary(catalog, branch)).toEqual([`removed flow ${gone.id}`]);
    expect(changes[0]!.branch).toBeUndefined();
    expect(sameEntity(changes[0]!.base, gone)).toBe(true);
  });
});

describe("stateAgainstMain", () => {
  const edit = (c: Catalog, label: string) => {
    const flow = longFlow(c);
    const step = walkSteps(flow.steps)[1]!;
    step.label = label;
  };

  it("keeps the branch's change when main has not moved since the base", () => {
    const branch = branched((c) => edit(c, "on the branch"));
    const [change] = diffBranch(catalog, branch);
    expect(stateAgainstMain(change!, mainEntities(catalog).get(`flow:${change!.id}`))).toBe("changed");
  });

  it("calls it a conflict when main changed the same entity differently", () => {
    const branch = branched((c) => edit(c, "on the branch"));
    const main = branched((c) => edit(c, "on main"));
    const [change] = diffBranch(catalog, branch);
    expect(stateAgainstMain(change!, mainEntities(main).get(`flow:${change!.id}`))).toBe("conflict");
  });

  it("does not call it a conflict when main made the same change", () => {
    const branch = branched((c) => edit(c, "the same"));
    const main = branched((c) => edit(c, "the same"));
    const [change] = diffBranch(catalog, branch);
    expect(stateAgainstMain(change!, mainEntities(main).get(`flow:${change!.id}`))).toBe("changed");
  });

  it("calls two branches adding one id differently a conflict", () => {
    const added = { id: "flow.new", slug: "new", name: "New" };
    expect(stateAgainstMain({ kind: "flow", id: "flow.new", change: "added", branch: added }, { ...added, name: "Other" })).toBe("conflict");
    expect(stateAgainstMain({ kind: "flow", id: "flow.new", change: "added", branch: added }, undefined)).toBe("added");
  });
});

describe("alignSteps", () => {
  const step = (id: string, from: string, to: string, label: string): Step => ({ type: "step", id, from, to, kind: "call", label, status: "declared" });
  const flow = (steps: Step[]): Flow => ({ id: "flow.x", slug: "x", name: "X", summary: "", owner: "shop", participants: [], steps });

  const base = flow([step("s1", "client", "api", "login"), step("s2", "api", "db", "ByEmail"), step("s3", "api", "api", "Check"), step("s4", "api", "bus", "Started")]);

  it("reads a step inserted near the top as one step added, not a renumbered flow", () => {
    const branch = flow([
      step("s1", "client", "api", "login"),
      step("s2", "api", "webauthn", "Verify"),
      step("s3", "api", "db", "ByEmail"),
      step("s4", "api", "api", "Check"),
      step("s5", "api", "bus", "Started"),
    ]);
    const aligned = alignSteps(base, branch);
    expect([...aligned.branch]).toEqual([["s2", { change: "added" }]]);
    expect(aligned.removed).toEqual([]);
  });

  it("reads a step whose label moved between the same ends as changed, with what it was", () => {
    const branch = flow([step("s1", "client", "api", "login"), step("s2", "api", "db", "ByEmail"), step("s3", "api", "api", "CheckPasswordOrPasskey"), step("s4", "api", "bus", "Started")]);
    const aligned = alignSteps(base, branch);
    expect(aligned.branch.get("s3")?.change).toBe("changed");
    expect(aligned.branch.get("s3")?.was?.label).toBe("Check");
    expect(aligned.branch.size).toBe(1);
  });

  it("reports a step the branch dropped as removed", () => {
    const branch = flow([step("s1", "client", "api", "login"), step("s2", "api", "api", "Check"), step("s3", "api", "bus", "Started")]);
    const aligned = alignSteps(base, branch);
    expect(aligned.branch.size).toBe(0);
    expect(aligned.removed.map((s) => s.label)).toEqual(["ByEmail"]);
  });
});
