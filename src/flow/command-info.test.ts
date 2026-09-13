import { describe, expect, it } from "vitest";
import type { Catalog, Service } from "../catalog";
import type { ChainNode, EventChain } from "./chain";
import { commandAnchor, commandEntries, commandSummary, isCommandHash, problemBranches } from "./command-info";

const event = (id: string, children: ChainNode[] = []): ChainNode => ({
  kind: "event", id, name: id, publisher: "shop.oms", context: "shop",
  flow: "cancel", stepId: id, number: 2, depth: 1,
  status: "declared", worst: "declared", children,
});
const consumer: ChainNode = { kind: "consumer", service: "payments.ledger", context: "payments", known: true,
  status: "declared", worst: "declared", depth: 2, children: [] };
const chain = (nodes: ChainNode[], truncated = false): EventChain => ({ root: "CancelOrder", nodes, count: nodes.length, truncated });

describe("command summaries", () => {
  it("counts unique known events and downstream services, not repeated occurrences", () => {
    const summary = commandSummary(chain([event("cancelled", [consumer]), event("cancelled", [consumer])]), "shop.oms");
    expect(summary).toEqual({ events: 1, services: 1, incomplete: true, unknown: false });
  });
  it("distinguishes unknown consequences from a known event with no listed consumers", () => {
    expect(commandSummary(chain([]), "shop.oms")).toMatchObject({ unknown: true, incomplete: true });
    expect(commandSummary(chain([event("cancelled")]), "shop.oms")).toEqual({ events: 1, services: 0, unknown: false, incomplete: false });
    expect(commandSummary(chain([event("cancelled")], true), "shop.oms").incomplete).toBe(true);
  });
  it("marks depth limits and unresolved steps as partial while repetitions do not imply missing evidence", () => {
    expect(commandSummary(chain([{ ...event("cancelled"), cut: { reason: "depth", hidden: 2 } }]), "shop.oms").incomplete).toBe(true);
    expect(commandSummary(chain([{ ...event("cancelled"), status: "unresolved" }]), "shop.oms").incomplete).toBe(true);
    expect(commandSummary(chain([{ ...event("cancelled"), cut: { reason: "seen", hidden: 2 } }]), "shop.oms").incomplete).toBe(false);
  });
  it("filters gaps with their ancestry and removes healthy sibling branches", () => {
    const root: ChainNode = { kind: "execution", flow: "cancel", name: "Cancel", stepId: "s1", number: 1,
      depth: 0, status: "declared", worst: "declared", children: [event("healthy"), event("gap", [consumer])] };
    const filtered = problemBranches([root]);
    expect(filtered[0]!.children).toEqual([event("gap", [consumer])]);
    expect(root.children).toHaveLength(2);
    expect(problemBranches([event("healthy")])).toEqual([]);
  });
});

describe("command links", () => {
  it("round trips command names with spaces, slashes, unicode and literal percent signs", () => {
    for (const id of ["CancelOrder", "foo/bar", "Заказ #1%", "A B"]) {
      expect(isCommandHash(`#${encodeURIComponent(commandAnchor(id))}`, id)).toBe(true);
    }
    expect(isCommandHash("#command-%", "CancelOrder")).toBe(false);
    expect(isCommandHash("#bb-commands", "CancelOrder")).toBe(false);
    expect(isCommandHash("#command-Other", "CancelOrder")).toBe(false);
  });
});

describe("command entries", () => {
  const service = { provides: [{ id: "shop.OrderService", source: "order.proto:7", methods: [{ name: "CancelOrder" }] }] } as Service;
  const execution: ChainNode = { kind: "execution", flow: "cancel", name: "Cancel", stepId: "s1", number: 1,
    depth: 0, status: "declared", worst: "declared", children: [] };
  const catalog = { flows: [{ slug: "cancel", name: "Cancel", steps: [
    { type: "step", id: "s1", kind: "rpc", ref: "shop.OrderService/CancelOrder", line: "handlers.rs:5" },
  ] }] } as Catalog;
  it("uses the actual protocol contract and handler source", () => {
    expect(commandEntries(catalog, service, chain([execution]))).toEqual([
      { flow: "cancel", stepId: "s1", label: "gRPC · shop.OrderService/CancelOrder", source: "handlers.rs:5" },
    ]);
    const http = structuredClone(service);
    http.provides[0]!.methods[0]!.http = { method: "POST", path: "/orders/{id}/cancel" };
    expect(commandEntries(catalog, http, chain([execution]))[0]!.label).toBe("POST /orders/{id}/cancel");
  });
  it("uses event and schedule triggers only for linked internal command calls", () => {
    const c = structuredClone(catalog);
    c.flows[0]!.steps = [
      { type: "step", id: "event", kind: "event", label: "OrderPlaced", from: "bus", to: "oms", status: "declared" },
      { type: "step", id: "s1", kind: "call", ref: "shop.oms.order/CancelOrder", from: "oms", to: "oms", status: "declared" },
    ];
    expect(commandEntries(c, service, chain([execution]))[0]!.label).toBe("Event · OrderPlaced");
    c.flows[0]!.steps.shift();
    c.flows[0]!.trigger = { kind: "scheduled", label: "every minute", confidence: "high" };
    expect(commandEntries(c, service, chain([execution]))[0]!.label).toBe("Schedule · every minute");
  });
});
