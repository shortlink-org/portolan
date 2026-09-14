import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog-sources.mjs";
import { commandChain } from "../src/flow/chain.ts";
import { commandEntries, commandSummary } from "../src/flow/command-info.ts";

describe("generated example command chains", { timeout: 30_000 }, () => {
  it("connects CancelOrder from the BFF through the Rust handler to OrderCancelled and ledger", async () => {
    const { catalog } = await loadCatalog("portolan.json", { profile: "example" });
    const service = catalog.contexts.find((c) => c.id === "shop").services.find((s) => s.id === "shop.oms");
    const aggregate = service.aggregates.find((a) => a.slug === "order");
    const operation = aggregate.operations.find((op) => op.id === "CancelOrder");
    const chain = commandChain(catalog, service, aggregate, operation);
    const caller = chain.nodes.find((node) => node.flow === "bff-mutation-cancel-order");
    const handler = caller.children.find((node) => node.flow === "oms-cancel-order");
    const event = handler.children.find((node) => node.id === "shop.oms.order.OrderCancelled");
    expect(event.children.some((node) => node.service === "payments.ledger")).toBe(true);
    expect(commandSummary(chain, service.id)).toMatchObject({ unknown: false });
    expect(commandEntries(catalog, service, chain).some((entry) => entry.label.includes("CancelOrder") && entry.source)).toBe(true);
    expect(operation.source).toContain("cancel_order/mod.rs:");

    const place = aggregate.operations.find((op) => op.id === "PlaceOrder");
    const policy = commandChain(catalog, service, aggregate, place);
    expect(commandEntries(catalog, service, policy).some((entry) => entry.label.startsWith("Event ·"))).toBe(true);
    expect(commandSummary(policy, service.id).events).toBeGreaterThan(0);
  });
});
