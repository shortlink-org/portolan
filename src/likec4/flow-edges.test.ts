import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import type { Flow } from "../catalog";
import { walkSteps } from "../catalog";
import { hiddenStepIds } from "../flow/cross-context";
import {
  drawnEdgeStepIds,
  drawnStepIds,
  pairEdgesToSteps,
} from "./flow-edges";

describe("pairEdgesToSteps", () => {
  it("pairs by position, both ways", () => {
    const pairing = pairEdgesToSteps(
      ["step-01", "step-02:par.01", "step-02:par.02"],
      ["s1", "s2", "s3"],
    );
    expect(pairing.stepOf.get("step-02:par.01")).toBe("s2");
    expect(pairing.edgeOf.get("s3")).toBe("step-02:par.02");
  });

  it("pairs a request and its generated response to the same catalog step", () => {
    const pairing = pairEdgesToSteps(
      ["step-01", "step-02"],
      ["request", "request"],
    );
    expect(pairing.stepOf.get("step-02")).toBe("request");
    expect(pairing.edgeOf.get("request")).toBe("step-01");
    expect(pairing.edgesOf.get("request")).toEqual(["step-01", "step-02"]);
  });

  /**
   * A length mismatch means the generator and the view have drifted. Guessing
   * would light the wrong arrow, which is worse than lighting none, so the
   * pairing is abandoned and highlighting simply stops.
   */
  it("abandons the pairing rather than guessing when the lists differ", () => {
    const pairing = pairEdgesToSteps(["step-01"], ["s1", "s2"]);
    expect(pairing.stepOf.size).toBe(0);
    expect(pairing.edgeOf.size).toBe(0);
    expect(pairing.edgesOf.size).toBe(0);
  });
});

describe("drawnStepIds", () => {
  it("lists every step of the full view, in rail order", () => {
    for (const flow of catalog.flows) {
      expect(drawnStepIds(flow, false), flow.slug).toEqual(
        walkSteps(flow.steps).map((s) => s.id),
      );
    }
  });

  it("drops exactly what the cross-context view hides", () => {
    for (const flow of catalog.flows) {
      const hidden = hiddenStepIds(flow);
      const drawn = drawnStepIds(flow, true);
      expect(
        drawn.some((id) => hidden.has(id)),
        flow.slug,
      ).toBe(false);
      expect(drawn.length, flow.slug).toBe(
        walkSteps(flow.steps).length - hidden.size,
      );
    }
  });
});

describe("drawnEdgeStepIds", () => {
  it("returns nested RPC responses in place and the actor response at the end", () => {
    const flow: Flow = {
      id: "flow.checkout",
      slug: "checkout",
      name: "Checkout",
      summary: "",
      owner: "shop",
      participants: [
        { id: "client", kind: "actor", context: null },
        { id: "shop.cart", kind: "service", context: "shop" },
        { id: "auth.auth", kind: "service", context: "auth" },
      ],
      steps: [
        {
          type: "step",
          id: "root",
          from: "client",
          to: "shop.cart",
          kind: "rpc",
          status: "declared",
        },
        {
          type: "step",
          id: "nested",
          from: "shop.cart",
          to: "auth.auth",
          kind: "rpc",
          status: "declared",
        },
        {
          type: "step",
          id: "done",
          from: "shop.cart",
          to: "client",
          kind: "event",
          status: "declared",
        },
      ],
    };

    expect(
      drawnEdgeStepIds(flow, false, new Set(["root", "nested"])),
    ).toEqual(["root", "nested", "nested", "done", "root"]);
  });
});
