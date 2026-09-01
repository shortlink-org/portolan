import { describe, expect, it } from "vitest";
import raw from "../../data/catalog.json";
import type { Catalog, Flow } from "../catalog";
import { stepFrames, walkSteps } from "../catalog";
import { hiddenStepIds } from "./cross-context";
import { flowPaths } from "./paths";
import { buildOutline, outlineSteps } from "./outline";
import type { OutlineFrame } from "./outline";

const catalog = raw as unknown as Catalog;
const checkout = catalog.flows.find((f) => f.slug === "checkout") as Flow;

const NO_FILTER = { hidden: new Set<string>(), crossOnly: false };

function frames(rows: ReturnType<typeof buildOutline>): OutlineFrame[] {
  return rows.filter((r): r is OutlineFrame => r.type === "frame");
}

describe("buildOutline", () => {
  it("heads every frame with the keyword its shape calls for", () => {
    const keywords = frames(buildOutline(checkout, NO_FILTER)).map(
      (f) => f.keyword,
    );
    expect(keywords.length).toBeGreaterThan(0);
    // A choice always opens with `alt` and continues with `else`; a parallel
    // opens with `par` and continues with `and`. Neither continuation can
    // appear before its opening, or the rail would show a branch of nothing.
    const seenAlt = keywords.indexOf("alt");
    const seenPar = keywords.indexOf("par");
    expect(keywords.indexOf("else") === -1 || seenAlt !== -1).toBe(true);
    expect(keywords.indexOf("and") === -1 || seenPar !== -1).toBe(true);
    if (keywords.includes("else")) {
      expect(seenAlt).toBeLessThan(keywords.indexOf("else"));
    }
    if (keywords.includes("and")) {
      expect(seenPar).toBeLessThan(keywords.indexOf("and"));
    }
    for (const f of frames(buildOutline(checkout, NO_FILTER))) {
      // Only `and` is nameless: it continues a parallel that is already named.
      if (f.keyword !== "and") expect(f.title, f.keyword).toBeTruthy();
    }
  });

  it("marks exactly the branches the catalog calls terminal", () => {
    for (const flow of catalog.flows) {
      const rows = buildOutline(flow, NO_FILTER);
      const marked = frames(rows)
        .filter((f) => f.terminal)
        .map((f) => f.title);
      const declared = [...stepFrames(flow.steps).values()]
        .flat()
        .filter((f) => f.terminal)
        .map((f) => f.branch);
      expect([...new Set(marked)].sort(), flow.slug).toEqual(
        [...new Set(declared)].sort(),
      );
    }
  });

  it("indents every step by how many frames enclose it", () => {
    for (const flow of catalog.flows) {
      const enclosing = stepFrames(flow.steps);
      for (const row of outlineSteps(buildOutline(flow, NO_FILTER))) {
        expect(row.depth, `${flow.slug} ${row.step.id}`).toBe(
          (enclosing.get(row.step.id) ?? []).length,
        );
      }
    }
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
    const first = walkSteps(checkout.steps)[0];
    if (!first) throw new Error("fixture has no steps");
    const hidden = new Set(
      walkSteps(checkout.steps)
        .map((s) => s.id)
        .filter((id) => id !== first.id),
    );
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    expect(frames(rows)).toEqual([]);
    expect(outlineSteps(rows).map((r) => r.step.id)).toEqual([first.id]);
  });

  it("opens the frame at the first branch that survives the filter", () => {
    // Hide every step of the first alt branch: the next surviving branch must
    // read `alt`, not `else`, or the rail shows a choice with no opening arm.
    const enclosing = stepFrames(checkout.steps);
    const firstAlt = [...enclosing.values()]
      .flat()
      .find((f) => f.kind === "alt");
    if (!firstAlt) throw new Error("fixture has no alt");
    const firstBranch = firstAlt.branch;
    const hidden = new Set(
      walkSteps(checkout.steps)
        .map((s) => s.id)
        .filter((id) =>
          (enclosing.get(id) ?? []).some(
            (f) => f.id === firstAlt.id && f.branch === firstBranch,
          ),
        ),
    );
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    const opening = frames(rows).find(
      (f) => f.keyword === "alt" || f.keyword === "else",
    );
    expect(opening?.keyword).toBe("alt");
    expect(opening?.title).not.toBe(firstBranch);
  });

  it("greys the steps off a chosen path instead of dropping them", () => {
    const path = flowPaths(checkout).paths.find((p) => p.terminal);
    if (!path) throw new Error("fixture has no terminal path");
    const all = walkSteps(checkout.steps).map((s) => s.id);
    const rows = buildOutline(checkout, { ...NO_FILTER, path: path.stepIds });

    // Every step is still drawn: the branch selector says which run to read,
    // not which steps exist.
    expect(outlineSteps(rows).map((r) => r.step.id)).toEqual(all);
    const onPath = outlineSteps(rows)
      .filter((r) => !r.offPath)
      .map((r) => r.step.id);
    expect(onPath).toEqual(all.filter((id) => path.stepIds.has(id)));
  });

  it("greys a branch frame only when nothing under it is on the path", () => {
    const path = flowPaths(checkout).paths.find((p) => p.terminal);
    if (!path) throw new Error("fixture has no terminal path");
    const rows = buildOutline(checkout, { ...NO_FILTER, path: path.stepIds });
    const choices = frames(rows).filter(
      (f) => f.keyword === "alt" || f.keyword === "else",
    );

    // The conditions the path chose are the ones left lit, and every other arm
    // of every alt recedes.
    const lit = choices.filter((f) => !f.offPath).map((f) => f.title);
    expect(lit).toEqual(path.choices.map((c) => c.title));
    expect(choices.some((f) => f.offPath)).toBe(true);
  });

  it("numbers every step by its place in the whole flow, path or not", () => {
    const order = walkSteps(checkout.steps).map((s) => s.id);
    const path = flowPaths(checkout).paths.find((p) => p.terminal);
    if (!path) throw new Error("fixture has no terminal path");
    const rows = buildOutline(checkout, { ...NO_FILTER, path: path.stepIds });
    expect(outlineSteps(rows).map((r) => r.number)).toEqual(
      order.map((_, i) => i + 1),
    );
  });

  it("composes the path marking with the cross-context filter", () => {
    const hidden = hiddenStepIds(checkout);
    const path = flowPaths(checkout).paths.find((p) => p.terminal);
    if (!path) throw new Error("fixture has no terminal path");
    const rows = buildOutline(checkout, {
      hidden,
      crossOnly: true,
      path: path.stepIds,
    });
    // The filter still drops; the path still only marks.
    expect(outlineSteps(rows).map((r) => r.step.id)).toEqual(
      walkSteps(checkout.steps)
        .map((s) => s.id)
        .filter((id) => !hidden.has(id)),
    );
    expect(
      outlineSteps(rows)
        .filter((r) => !r.offPath)
        .every((r) => path.stepIds.has(r.step.id)),
    ).toBe(true);
  });

  it("emits nothing but steps for a flow with no frames", () => {
    const flat = catalog.flows.find(
      (f) =>
        stepFrames(f.steps).size > 0 &&
        [...stepFrames(f.steps).values()].every((s) => s.length === 0),
    );
    if (!flat) throw new Error("fixture has no flat flow");
    const rows = buildOutline(flat, NO_FILTER);
    expect(frames(rows)).toEqual([]);
    expect(rows).toHaveLength(outlineSteps(rows).length);
  });
});
