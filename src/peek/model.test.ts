import { describe, expect, it, vi } from "vitest";
import { allEvents, allServices, walkSteps } from "../catalog";
import { catalog, index } from "../testing/estate";
import { flowStepId } from "../selection/model";
import { BLURB_CHARS, blurbOf, count, peekOf } from "./model";

// The live catalog under test is Portolan's own: three services, no
// aggregate, no event. A card is about what an event or a table says of
// itself, so the frozen estate is what these run against.
vi.mock("../data", async () => {
  const estate = await import("../testing/estate");
  return { catalog: estate.catalog, index: estate.index };
});

describe("blurbOf", () => {
  it("is null for nothing written", () => {
    expect(blurbOf(undefined)).toBeNull();
    expect(blurbOf("")).toBeNull();
    expect(blurbOf("```go\nfunc main() {}\n```")).toBeNull();
  });

  it("flattens markdown, drops the heading, and keeps short prose whole", () => {
    expect(blurbOf("# Orders\n\nThe **order** book.\n\n## States\n\nOpen.")).toBe(
      "The order book. Open.",
    );
  });

  it("cuts long prose at a word and says so", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const blurb = blurbOf(words)!;
    expect(blurb.length).toBeLessThanOrEqual(BLURB_CHARS + 1);
    expect(blurb.endsWith("…")).toBe(true);
    expect(
      blurb
        .slice(0, -1)
        .split(" ")
        .every((w) => /^word\d+$/.test(w)),
    ).toBe(true);
  });

  it("does not leave a comma hanging before the ellipsis", () => {
    const text = `${"a".repeat(150)}, ${"b".repeat(40)}`;
    expect(blurbOf(text)).toBe(`${"a".repeat(150)}…`);
  });
});

describe("count", () => {
  it("agrees the noun with the number", () => {
    expect(count(1, "flow")).toEqual({
      countable: true,
      label: "flow",
      value: "1",
    });
    expect(count(0, "flow")).toEqual({
      countable: true,
      label: "flows",
      value: "0",
    });
    expect(count(2, "entity", "entities")).toEqual({
      countable: true,
      label: "entities",
      value: "2",
    });
  });
});

describe("peekOf", () => {
  it("answers for every context, service, aggregate and event", () => {
    expect(allEvents(catalog).length).toBeGreaterThan(0);
    for (const context of catalog.contexts) {
      const peek = peekOf(context.id);
      expect(peek?.kind, context.id).toBe("context");
      expect(peek?.contextId).toBe(context.id);
      for (const service of context.services) {
        expect(peekOf(service.id)?.kind, service.id).toBe("service");
        for (const aggregate of service.aggregates) {
          expect(peekOf(aggregate.id)?.kind, aggregate.id).toBe("aggregate");
          for (const event of aggregate.events) {
            expect(peekOf(event.id)?.kind, event.id).toBe("event");
          }
        }
      }
    }
  });

  it("answers for every store, table, view and column", () => {
    expect((catalog.stores ?? []).length).toBeGreaterThan(0);
    for (const store of catalog.stores ?? []) {
      expect(peekOf(store.id)?.kind, store.id).toBe("store");
      for (const table of store.tables) {
        expect(peekOf(table.id)?.kind, table.id).toBe("table");
        for (const column of table.columns) {
          const peek = peekOf(`${table.id}.${column.name}`);
          expect(peek?.kind, column.name).toBe("table");
          expect(peek?.facts[0]).toEqual({ label: "type", value: column.type });
        }
      }
      for (const view of store.views ?? []) {
        expect(peekOf(view.id)?.kind, view.id).toBe("view");
      }
    }
  });

  it("answers for every shared type", () => {
    expect(Object.keys(catalog.defs).length).toBeGreaterThan(0);
    for (const defId of Object.keys(catalog.defs)) {
      expect(peekOf(defId)?.kind, defId).toBe("def");
    }
  });

  it("says who publishes an event and how many consume it", () => {
    const event = allEvents(catalog).find((e) => e.consumers.length > 0)!;
    expect(event).toBeDefined();
    const owner = index.eventOwner.get(event.id)!;
    const peek = peekOf(event.id)!;
    expect(peek.name).toBe(event.name);
    expect(peek.where).toContain(owner.service.name);
    expect(peek.where).toContain(owner.aggregate.name);
    const consumers = peek.facts.find((f) => f.label.startsWith("consumer"));
    expect(consumers?.value).toBe(String(event.consumers.length));
    const latest = event.versions[event.versions.length - 1]!;
    expect(peek.facts.find((f) => f.label === "version")?.value).toBe(
      latest.version,
    );
  });

  it("counts a service's aggregates and events", () => {
    const service = allServices(catalog).find((s) => s.aggregates.length > 0)!;
    expect(service).toBeDefined();
    const peek = peekOf(service.id)!;
    const events = service.aggregates.reduce((n, a) => n + a.events.length, 0);
    expect(peek.facts.find((f) => f.label.startsWith("aggregate"))?.value).toBe(
      String(service.aggregates.length),
    );
    expect(peek.facts.find((f) => f.label.startsWith("event"))?.value).toBe(
      String(events),
    );
  });

  it("keeps every blurb to two lines", () => {
    const blurbs = allServices(catalog)
      .map((s) => peekOf(s.id)?.blurb)
      .filter((b): b is string => !!b);
    expect(blurbs.length).toBeGreaterThan(0);
    for (const blurb of blurbs) {
      expect(blurb.length).toBeLessThanOrEqual(BLURB_CHARS + 1);
    }
  });

  it("is null for what the catalog does not know, and for a flow step", () => {
    expect(peekOf("nope.nothing.Here")).toBeNull();
    const flow = catalog.flows[0]!;
    const step = walkSteps(flow.steps)[0]!;
    expect(peekOf(flowStepId(flow.slug, step.id))).toBeNull();
  });
});
