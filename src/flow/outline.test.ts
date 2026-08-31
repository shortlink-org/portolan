import { describe, expect, it } from "vitest";
import raw from "../../data/catalog.json";
import type { Catalog, Flow } from "../catalog";
import { hiddenStepIds } from "./cross-context";
import { buildOutline, outlineSteps } from "./outline";
import type { OutlineFrame } from "./outline";

const catalog = raw as unknown as Catalog;
const checkout = catalog.flows.find((f) => f.slug === "checkout") as Flow;

const NO_FILTER = { hidden: new Set<string>(), crossOnly: false };

function frames(rows: ReturnType<typeof buildOutline>): OutlineFrame[] {
  return rows.filter((r): r is OutlineFrame => r.type === "frame");
}

describe("buildOutline", () => {
  it("heads every frame, in sequence-diagram keywords", () => {
    const got = frames(buildOutline(checkout, NO_FILTER)).map((f) => [
      f.keyword,
      f.title,
    ]);
    expect(got).toEqual([
      ["alt", "risk score below threshold"],
      ["par", "authorise and announce"],
      ["and", undefined],
      ["else", "risk score above threshold"],
      ["loop", "until captured, at most 3 attempts"],
    ]);
  });

  it("marks the branch that ends the flow", () => {
    const terminal = frames(buildOutline(checkout, NO_FILTER)).filter(
      (f) => f.terminal,
    );
    expect(terminal.map((f) => f.title)).toEqual([
      "risk score above threshold",
    ]);
  });

  it("indents steps under the frame that holds them", () => {
    const rows = buildOutline(checkout, NO_FILTER);
    const byId = new Map(outlineSteps(rows).map((r) => [r.step.id, r]));
    expect(byId.get("s3")?.depth).toBe(0); // before the alt
    expect(byId.get("s6")?.depth).toBe(1); // inside the alt
    expect(byId.get("s4")?.depth).toBe(2); // inside the parallel inside it
    expect(byId.get("s8")?.depth).toBe(1); // inside the loop
  });

  it("numbers over every step, filtered or not", () => {
    const all = outlineSteps(buildOutline(checkout, NO_FILTER));
    expect(all.map((r) => r.number)).toEqual(all.map((_, i) => i + 1));

    const hidden = hiddenStepIds(checkout);
    const filtered = outlineSteps(
      buildOutline(checkout, { hidden, crossOnly: true }),
    );
    // The numbers survive the filter, so "step 7" means the same thing in both.
    for (const row of filtered) {
      expect(row.number).toBe(
        all.find((r) => r.step.id === row.step.id)?.number,
      );
    }
    expect(filtered.length).toBeLessThan(all.length);
  });

  it("drops a frame whose every step the filter removed", () => {
    // s9 is the only step of the loop that is not cross-context; hiding
    // everything else must take the loop header with it.
    const hidden = new Set(
      outlineSteps(buildOutline(checkout, NO_FILTER))
        .map((r) => r.step.id)
        .filter((id) => id !== "s3"),
    );
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    expect(frames(rows)).toEqual([]);
    expect(outlineSteps(rows).map((r) => r.step.id)).toEqual(["s3"]);
  });

  it("opens the frame at the first branch that survives the filter", () => {
    // Hide the whole first alt branch: the second one must read "alt", not
    // "else", or the rail would show a choice with no opening arm.
    const hidden = new Set(["s4", "s5", "s6"]);
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    const alt = frames(rows).filter(
      (f) => f.keyword === "alt" || f.keyword === "else",
    );
    expect(alt).toHaveLength(1);
    expect(alt[0]?.keyword).toBe("alt");
    expect(alt[0]?.title).toBe("risk score above threshold");
    expect(alt[0]?.terminal).toBe(true);
  });

  it("emits nothing but steps for a flow with no frames", () => {
    const flat = catalog.flows.find((f) => f.slug === "order-accepted") as Flow;
    const rows = buildOutline(flat, NO_FILTER);
    expect(frames(rows)).toEqual([]);
    expect(rows).toHaveLength(outlineSteps(rows).length);
  });
});
