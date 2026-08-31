import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { walkSteps } from "../catalog";
import { encodeSelection, parseSelectionHash, selectionHash } from "./hash";
import { flowStepId, selectionFor } from "./model";

describe("selection hash", () => {
  it("writes the form the spec names", () => {
    expect(encodeSelection(selectionFor("shop.oms.order.OrderPlaced"))).toBe(
      "sel=event:shop.oms.order.OrderPlaced",
    );
    expect(selectionHash(null)).toBe("");
  });

  it("round-trips every selectable id in the catalog", () => {
    const ids: string[] = [...Object.keys(catalog.defs)];
    for (const context of catalog.contexts) {
      ids.push(context.id);
      for (const service of context.services) {
        ids.push(service.id);
        for (const aggregate of service.aggregates) {
          ids.push(aggregate.id);
          for (const event of aggregate.events) ids.push(event.id);
        }
      }
    }
    for (const flow of catalog.flows) {
      for (const step of walkSteps(flow.steps)) {
        ids.push(flowStepId(flow.slug, step.id));
      }
    }

    for (const id of ids) {
      const selection = selectionFor(id);
      expect(parseSelectionHash(selectionHash(selection)), id).toEqual(
        selection,
      );
    }
  });

  it("escapes the slash in a flow step so the id survives the URL", () => {
    const hash = selectionHash(selectionFor(flowStepId("checkout", "s6")));
    expect(hash).toBe("#sel=flow-step:checkout%2Fs6");
    expect(parseSelectionHash(hash)?.id).toBe("checkout/s6");
  });

  /**
   * The kind in a link is a hint, not a claim. Re-deriving it means an old
   * link to something that has since changed shape still opens the right kind
   * of panel instead of a wrong one.
   */
  it("re-derives the kind rather than trusting the URL", () => {
    expect(parseSelectionHash("#sel=service:shop.oms.order.OrderPlaced")).toEqual(
      { kind: "event", id: "shop.oms.order.OrderPlaced" },
    );
    expect(parseSelectionHash("#sel=event:gone.for.good")).toEqual({
      kind: "unknown",
      id: "gone.for.good",
    });
  });

  it("ignores hashes that are not ours", () => {
    expect(parseSelectionHash("")).toBeNull();
    expect(parseSelectionHash("#bb-commands")).toBeNull();
    expect(parseSelectionHash("#sel=")).toBeNull();
    expect(parseSelectionHash("#sel=event:")).toBeNull();
    expect(parseSelectionHash("#sel=nonsense:shop")).toBeNull();
  });

  it("survives a malformed escape instead of throwing", () => {
    expect(parseSelectionHash("#sel=event:%E0%A4%A")).toBeNull();
  });
});
