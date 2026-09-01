import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { contextStats, edgeCount, problems } from "./derive";
import type { Catalog } from "../catalog";

describe("problems", () => {
  it("finds every unresolved edge and nothing else", () => {
    for (const problem of problems(catalog)) {
      const context = catalog.contexts.find((c) => c.id === problem.context);
      const service = context?.services.find((s) => s.id === problem.service);
      expect(
        service,
        `${problem.id} names a service not in the catalog`,
      ).toBeDefined();

      if (problem.kind === "rpc") {
        const call = service?.consumes.find((c) => c.id === problem.id);
        expect(call?.status).toBe("unresolved");
        expect(call?.peer).toBe(problem.peer);
      } else {
        const event = service?.aggregates
          .flatMap((a) => a.events)
          .find((e) => e.id === problem.id);
        const consumer = event?.consumers.find(
          (c) => c.service === problem.peer,
        );
        expect(consumer?.status).toBe("unresolved");
      }
    }
  });

  it("agrees with the per-context counts the overview prints", () => {
    // The overview card and the problems page must never disagree about how
    // much is broken - they are two renderings of one number.
    const found = problems(catalog);
    for (const context of catalog.contexts) {
      const mine = found.filter((p) => p.context === context.id);
      expect(mine.length, `context ${context.id}`).toBe(
        contextStats(context).unresolved,
      );
    }
  });

  it("says nothing at all about a clean catalog", () => {
    const clean: Catalog = {
      ...catalog,
      contexts: catalog.contexts.map((context) => ({
        ...context,
        services: context.services.map((service) => ({
          ...service,
          consumes: service.consumes.map((c) => ({
            ...c,
            status: "verified" as const,
          })),
          aggregates: service.aggregates.map((aggregate) => ({
            ...aggregate,
            events: aggregate.events.map((event) => ({
              ...event,
              consumers: event.consumers.map((c) => ({
                ...c,
                status: "verified" as const,
              })),
            })),
          })),
        })),
      })),
    };
    expect(problems(clean)).toEqual([]);
  });
});

describe("edgeCount", () => {
  it("counts every call and consumer, resolved or not", () => {
    const byHand = catalog.contexts
      .flatMap((c) => c.services)
      .reduce(
        (n, s) =>
          n +
          s.consumes.length +
          s.aggregates.reduce(
            (m, a) =>
              m + a.events.reduce((k, e) => k + e.consumers.length, 0),
            0,
          ),
        0,
      );
    expect(edgeCount(catalog)).toBe(byHand);
    expect(edgeCount(catalog)).toBeGreaterThanOrEqual(problems(catalog).length);
  });

  it("is zero for a catalog whose services are not wired together", () => {
    const bare: Catalog = {
      ...catalog,
      contexts: catalog.contexts.map((context) => ({
        ...context,
        services: context.services.map((service) => ({
          ...service,
          consumes: [],
          aggregates: service.aggregates.map((aggregate) => ({
            ...aggregate,
            events: aggregate.events.map((event) => ({
              ...event,
              consumers: [],
            })),
          })),
        })),
      })),
    };
    expect(edgeCount(bare)).toBe(0);
    expect(problems(bare)).toEqual([]);
  });
});
