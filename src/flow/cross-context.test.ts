import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalog } from "../testing/estate";
// Same split as src/likec4/ids.test.ts: the predicate is checked against the
// frozen fixture, and the generated views against the estate they were
// generated from.
import { catalog as shipped } from "../data";
import { walkSteps } from "../catalog";
import {
  contextResolver,
  hiddenStepIds,
  isCrossContext,
} from "./cross-context";
import { flowCrossViewId, flowViewId } from "../likec4/ids";

const checkout = catalog.flows.find((f) => f.slug === "checkout");
if (!checkout) throw new Error("fixture missing checkout flow");

describe("isCrossContext", () => {
  it("drops internal calls, self messages and same-context hops", () => {
    expect([...hiddenStepIds(checkout)].sort()).toEqual([
      "s10",
      "s11",
      "s13",
      "s17",
      "s18",
      "s2",
      "s23",
      "s3",
      "s33",
      "s4",
      "s41",
      "s6",
      "s8",
    ]);
  });

  it("keeps hops touching a null-context lane", () => {
    const contextOf = contextResolver(checkout);
    const s12 = walkSteps(checkout.steps).find((s) => s.id === "s12");
    if (!s12) throw new Error("no s12");
    // shop.oms (shop) -> bus (null)
    expect(isCrossContext(s12, contextOf)).toBe(true);
  });
});

describe("generated LikeC4 views agree with the predicate", () => {
  const views = readFileSync("likec4/views.c4", "utf8");

  it("declares both a full and a cross view for every flow", () => {
    for (const flow of shipped.flows) {
      expect(views, flow.slug).toContain(`dynamic view ${flowViewId(flow)} {`);
      expect(views, flow.slug).toContain(
        `dynamic view ${flowCrossViewId(flow)} {`,
      );
    }
  });

  it("omits exactly the hidden steps from a cross view", () => {
    // Whichever shipped flow hides the most: the point is the predicate, and
    // pinning one flow by name is how this test broke when that flow left.
    const flow = [...shipped.flows].sort(
      (a, b) => hiddenStepIds(b).size - hiddenStepIds(a).size,
    )[0];
    if (!flow) throw new Error("no flows");
    const hidden = hiddenStepIds(flow);
    expect(hidden.size).toBeGreaterThan(0);

    const start = views.indexOf(`dynamic view ${flowCrossViewId(flow)} {`);
    expect(start, flow.slug).toBeGreaterThan(-1);
    const section = views.slice(
      start,
      views.indexOf("dynamic view", start + 10),
    );

    const labelOf = (id: string): string => {
      const step = walkSteps(flow.steps).find((s) => s.id === id);
      if (!step) throw new Error(`no step ${id}`);
      return step.label ?? step.ref ?? step.kind;
    };
    const shown = new Set(
      walkSteps(flow.steps)
        .filter((s) => !hidden.has(s.id))
        .map((s) => labelOf(s.id)),
    );
    for (const label of shown) {
      expect(section, `${flow.slug}: ${label}`).toContain(label);
    }
    // A hop the predicate hides is in no cross view - unless a hop that stays
    // happens to carry the same label, which is not this rule's business.
    for (const id of hidden) {
      const label = labelOf(id);
      if (shown.has(label)) continue;
      expect(section, `${flow.slug}: ${label}`).not.toContain(label);
    }
  });
});
