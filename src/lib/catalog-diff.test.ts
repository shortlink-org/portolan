import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import type { Catalog, Step } from "../catalog";
import { diffCatalogs } from "./catalog-diff";
import type { Change } from "./catalog-diff";

/**
 * Every case starts from the frozen estate and changes exactly one thing, so
 * what comes back is the change and nothing else. A diff that reports two
 * findings for one edit is the failure this is guarding against - it is what
 * turns a report into a list nobody reads.
 */
function edited(edit: (c: Catalog) => void): Change[] {
  const after = JSON.parse(JSON.stringify(catalog)) as Catalog;
  edit(after);

  return diffCatalogs(catalog, after);
}

const kinds = (changes: Change[]) => changes.map((c) => c.kind);

describe("diffCatalogs", () => {
  it("says nothing about a catalog compared with itself", () => {
    expect(diffCatalogs(catalog, catalog)).toEqual([]);
  });

  it("says nothing about a stamp, which is not a change anybody made", () => {
    expect(
      edited((c) => {
        c.commit = "0000000";
        c.generatedAt = "2030-01-01T00:00:00Z";
      }),
    ).toEqual([]);
  });
});

describe("diffCatalogs: what a reviewer is looking for", () => {
  // The finding the whole report exists for.
  it("names a new event nothing consumes", () => {
    const changes = edited((c) => {
      const aggregate = c.contexts[0]!.services[0]!.aggregates[0]!;
      const event = JSON.parse(JSON.stringify(aggregate.events[0]!));
      event.id = `${event.id}Twice`;
      event.slug = `${event.slug}-twice`;
      event.name = `${event.name}Twice`;
      event.consumers = [];
      aggregate.events.push(event);
      return c;
    });

    const added = changes.find((c) => c.kind === "event.added");
    expect(added?.summary).toMatch(/nothing consumes it/);
    expect(added?.severity).toBe("addition");
  });

  it("calls a removed event breaking, and counts who was reading it", () => {
    const changes = edited((c) => {
      const aggregate = c.contexts[0]!.services[0]!.aggregates[0]!;
      aggregate.events.shift();
    });

    const removed = changes.find((c) => c.kind === "event.removed");
    expect(removed?.severity).toBe("breaking");
    expect(kinds(changes)).toContain("event.removed");
  });

  it("calls a removed interface method breaking", () => {
    const changes = edited((c) => {
      const provided = c.contexts
        .flatMap((ctx) => ctx.services)
        .find((s) => s.provides.length > 0)!.provides[0]!;
      provided.methods.pop();
    });

    expect(changes.some((c) => c.kind === "method.removed" && c.severity === "breaking")).toBe(true);
  });

  it("reads a changed signature off the pair of shapes", () => {
    const changes = edited((c) => {
      const method = c.contexts
        .flatMap((ctx) => ctx.services)
        .find((s) => s.provides.some((p) => p.methods.length > 0))!
        .provides.find((p) => p.methods.length > 0)!.methods[0]!;
      method.response = "SomethingElse";
    });

    const change = changes.find((c) => c.kind === "method.signature");
    expect(change?.severity).toBe("breaking");
    expect(change?.summary).toContain("SomethingElse");
  });
});

describe("diffCatalogs: lifecycles", () => {
  const withLifecycle = (c: Catalog) =>
    c.contexts
      .flatMap((ctx) => ctx.services)
      .flatMap((s) => s.aggregates)
      .find((a) => a.lifecycle && a.lifecycle.transitions.length > 0)!;

  it("names a transition that is gone", () => {
    const changes = edited((c) => {
      withLifecycle(c).lifecycle!.transitions.pop();
    });

    const removed = changes.find((c) => c.kind === "transition.removed");
    expect(removed?.severity).toBe("breaking");
    expect(removed?.summary).toMatch(/-->/);
  });

  it("names a state a root can now reach", () => {
    const changes = edited((c) => {
      withLifecycle(c).lifecycle!.states.push("archived");
    });

    expect(kinds(changes)).toEqual(["state.added"]);
  });
});

describe("diffCatalogs: status is the one thing that has a direction", () => {
  const someStep = (c: Catalog): Step => {
    for (const flow of c.flows) {
      const first = flow.steps.find((n) => n.type === "step");
      if (first?.type === "step") return first;
    }
    throw new Error("the fixture has no flow with a step in it");
  };

  it("calls a hop that stopped being verified a regression", () => {
    // The fixture is frozen, so this is a fact and not a hope: if it ever
    // stops being one, the test that depends on it should say so first.
    expect(someStep(catalog).status).toBe("verified");

    const changes = edited((c) => {
      someStep(c).status = "declared";
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("step.status");
    expect(changes[0]!.severity).toBe("breaking");
  });

  it("does not call a hop that became verified breaking", () => {
    const before = JSON.parse(JSON.stringify(catalog)) as Catalog;
    someStep(before).status = "declared";

    const changes = diffCatalogs(before, catalog);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.severity).toBe("change");
  });
});

describe("diffCatalogs: ownership and pins", () => {
  it("says who took a service on", () => {
    const changes = edited((c) => {
      c.contexts[0]!.services[0]!.owners = ["@acme/oms-team"];
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe("owner.added");
    expect(changes[0]!.summary).toContain("@acme/oms-team");
  });

  // Handing a service over is one thing; a service with nobody left on it is
  // the one that goes unnoticed until somebody needs to ask a question.
  it("calls a service losing its last owner breaking", () => {
    const before = JSON.parse(JSON.stringify(catalog)) as Catalog;
    before.contexts[0]!.services[0]!.owners = ["@acme/oms-team"];
    const after = JSON.parse(JSON.stringify(catalog)) as Catalog;

    const changes = diffCatalogs(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.severity).toBe("breaking");
  });

  it("says when a vendored repository moved", () => {
    const before = JSON.parse(JSON.stringify(catalog)) as Catalog;
    before.repos = [{ repo: "github.com/acme/shop", commit: "1111111aaaa" }];
    const after = JSON.parse(JSON.stringify(catalog)) as Catalog;
    after.repos = [{ repo: "github.com/acme/shop", commit: "2222222bbbb" }];

    const changes = diffCatalogs(before, after);
    expect(changes).toEqual([
      {
        kind: "repo.commit",
        severity: "change",
        where: "github.com/acme/shop",
        summary: "github.com/acme/shop moved from 1111111 to 2222222",
      },
    ]);
  });
});

describe("diffCatalogs: an accepted decision is a frozen document", () => {
  it("says when one was edited anyway", () => {
    expect(catalog.adrs.some((a) => a.status === "accepted")).toBe(true);

    const changes = edited((c) => {
      c.adrs.find((a) => a.status === "accepted")!.body += "\n\nAnd another thing.\n";
    });

    expect(kinds(changes)).toEqual(["adr.body"]);
  });

  it("says nothing about editing one that is still proposed", () => {
    expect(catalog.adrs.some((a) => a.status === "proposed")).toBe(true);

    const changes = edited((c) => {
      c.adrs.find((a) => a.status === "proposed")!.body += "\n\nStill thinking.\n";
    });

    expect(changes).toEqual([]);
  });
});

describe("diffCatalogs: order", () => {
  it("puts what broke first, then what is new, then what moved", () => {
    const changes = edited((c) => {
      c.contexts[0]!.services[0]!.owners = ["@acme/oms-team"];
      c.contexts[0]!.services[0]!.aggregates[0]!.events.shift();
      const aggregate = c.contexts[0]!.services[0]!.aggregates[0]!;
      const copy = JSON.parse(JSON.stringify(aggregate));
      copy.id = `${copy.id}-two`;
      copy.slug = `${copy.slug}-two`;
      c.contexts[0]!.services[0]!.aggregates.push(copy);
    });

    const severities = changes.map((c) => c.severity);
    expect(severities).toEqual([...severities].sort(
      (a, b) =>
        ["breaking", "addition", "change"].indexOf(a) -
        ["breaking", "addition", "change"].indexOf(b),
    ));
  });
});
