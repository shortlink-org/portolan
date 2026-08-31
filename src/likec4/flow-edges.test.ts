import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { walkSteps } from "../catalog";
import { hiddenStepIds } from "../flow/cross-context";
import { drawnStepIds, pairEdgesToSteps } from "./flow-edges";

describe("pairEdgesToSteps", () => {
  it("pairs by position, both ways", () => {
    const pairing = pairEdgesToSteps(
      ["step-01", "step-02:par.01", "step-02:par.02"],
      ["s1", "s2", "s3"],
    );
    expect(pairing.stepOf.get("step-02:par.01")).toBe("s2");
    expect(pairing.edgeOf.get("s3")).toBe("step-02:par.02");
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
