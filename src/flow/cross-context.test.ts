import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { catalog } from "../data";
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
      "s13",
      "s2",
      "s3",
      "s9",
    ]);
  });

  it("keeps hops touching a null-context lane", () => {
    const contextOf = contextResolver(checkout);
    const s5 = walkSteps(checkout.steps).find((s) => s.id === "s5");
    if (!s5) throw new Error("no s5");
    // shop.oms (shop) -> bus (null)
    expect(isCrossContext(s5, contextOf)).toBe(true);
  });
});

describe("generated LikeC4 views agree with the predicate", () => {
  const views = readFileSync("likec4/views.c4", "utf8");

  it("declares both a full and a cross view for every flow", () => {
    for (const flow of catalog.flows) {
      expect(views, flow.slug).toContain(`dynamic view ${flowViewId(flow)} {`);
      expect(views, flow.slug).toContain(
        `dynamic view ${flowCrossViewId(flow)} {`,
      );
    }
  });

  it("omits exactly the hidden steps from the cross view of checkout", () => {
    const start = views.indexOf(`dynamic view ${flowCrossViewId(checkout)} {`);
    expect(start).toBeGreaterThan(-1);
    const section = views.slice(
      start,
      views.indexOf("dynamic view", start + 10),
    );
    const hidden = hiddenStepIds(checkout);
    for (const step of walkSteps(checkout.steps)) {
      const label = step.label ?? step.ref ?? step.kind;
      if (hidden.has(step.id)) continue;
      expect(section, `${step.id} ${label}`).toContain(label);
    }
    // the internal calls must not appear
    expect(section).not.toContain("validateBasket");
    expect(section).not.toContain("postJournalEntry");
    expect(section).not.toContain("planRoute");
  });
});
