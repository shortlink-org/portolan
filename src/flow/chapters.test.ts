import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import { walkSteps } from "../catalog";
import type { Flow } from "../catalog";
import { buildChapters, groupRows, railRows } from "./chapters";
import { buildOutline, outlineSteps } from "./outline";
import { hiddenStepIds } from "./cross-context";

const NO_FILTER = { hidden: new Set<string>(), crossOnly: false };

function flow(slug: string): Flow {
  const found = catalog.flows.find((f) => f.slug === slug);
  if (!found) throw new Error(`fixture has no flow ${slug}`);
  return found;
}

const checkout = flow("checkout");

describe("buildChapters", () => {
  it("covers every step of the flow exactly once", () => {
    for (const f of catalog.flows) {
      const covered = buildChapters(f).flatMap((c) => c.stepIds);
      expect(covered).toEqual(walkSteps(f.steps).map((s) => s.id));
    }
  });

  it("makes one chapter per top-level frame, and one per run between them", () => {
    const chapters = buildChapters(checkout);
    const topLevelFrames = checkout.steps.filter((n) => n.type !== "step");
    expect(chapters.filter((c) => c.kind !== "steps").map((c) => c.id)).toEqual(
      topLevelFrames.map((n) => n.id),
    );
    // Frames and runs alternate by construction, so no two runs can be
    // adjacent — a run that could continue is the same run.
    const kinds = chapters.map((c) => c.kind === "steps");
    expect(kinds.some((isRun, i) => isRun && kinds[i - 1] === true)).toBe(false);
  });

  it("does not promote a nested frame to a chapter of its own", () => {
    // par-captured sits inside alt-capture; it must belong to that chapter
    // rather than splitting it in two.
    const chapters = buildChapters(checkout);
    expect(chapters.map((c) => c.id)).not.toContain("par-captured");
    const owner = chapters.find((c) => c.stepIds.includes("s35"));
    expect(owner?.id).toBe("alt-capture");
  });

  it("numbers a chapter by the whole flow, frames included", () => {
    const chapters = buildChapters(checkout);
    const first = chapters[0];
    const last = chapters[chapters.length - 1];
    expect(first?.from).toBe(1);
    expect(last?.to).toBe(walkSteps(checkout.steps).length);
    // Ranges tile the flow: each chapter starts where the last one stopped.
    chapters.forEach((chapter, i) => {
      const previous = chapters[i - 1];
      if (previous) expect(chapter.from).toBe(previous.to + 1);
    });
  });

  it("names an alt by the question it asks and a run by its ends", () => {
    const chapters = buildChapters(checkout);
    const alt = chapters.find((c) => c.id === "alt-risk");
    expect(alt?.kind).toBe("alt");
    expect(alt?.title).toBe("score below 40");

    const opening = chapters[0];
    expect(opening?.kind).toBe("steps");
    expect(opening?.title).toBe("PlaceOrder → GetQuote");
  });

  it("counts status per chapter and lists the contexts it touches", () => {
    const chapter = buildChapters(checkout).find((c) => c.id === "alt-risk");
    if (!chapter) throw new Error("fixture has no alt-risk");
    const total =
      chapter.status.verified +
      chapter.status.declared +
      chapter.status.unresolved;
    expect(total).toBe(chapter.stepIds.length);
    expect(chapter.contexts).toEqual(["shop"]);
  });

  it("gives a flow with no frames exactly one chapter", () => {
    const flat = catalog.flows.find((f) =>
      f.steps.every((n) => n.type === "step"),
    );
    if (!flat) throw new Error("fixture has no flat flow");
    const chapters = buildChapters(flat);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.kind).toBe("steps");
  });
});

describe("groupRows", () => {
  const chapters = buildChapters(checkout);

  it("keeps the rail's order and loses none of its rows", () => {
    const rows = buildOutline(checkout, NO_FILTER);
    const groups = groupRows(rows, chapters);
    expect(groups.flatMap((g) => g.rows)).toEqual(rows);
  });

  it("gives a frame header to the chapter its body belongs to", () => {
    const rows = buildOutline(checkout, NO_FILTER);
    const groups = groupRows(rows, chapters);
    for (const { chapter, rows: owned } of groups) {
      for (const row of owned) {
        if (row.type === "step") expect(chapter.stepIds).toContain(row.step.id);
      }
    }
    // The alt's own header sits inside the alt's chapter, not the run before it.
    const risk = groups.find((g) => g.chapter.id === "alt-risk");
    expect(risk?.rows[0]?.type).toBe("frame");
  });

  it("drops a chapter the filter emptied rather than drawing it blank", () => {
    const hidden = hiddenStepIds(checkout);
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    const groups = groupRows(rows, chapters);
    const shown = new Set(groups.map((g) => g.chapter.id));
    const visible = new Set(outlineSteps(rows).map((r) => r.step.id));
    for (const chapter of chapters) {
      const survives = chapter.stepIds.some((id) => visible.has(id));
      expect(shown.has(chapter.id)).toBe(survives);
    }
    expect(groups.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("marks an alt chapter terminal when its opening branch ends the flow", () => {
    // alt-risk's arms are: score below 40, score at or above 40 (terminal),
    // scorer timed out. The opening arm is not the terminal one, so the header
    // must not claim the chapter ends the flow.
    const risk = chapters.find((c) => c.id === "alt-risk");
    expect(risk?.terminal).toBeUndefined();
  });

  it("drops the frame row the chapter header already is", () => {
    const rows = buildOutline(checkout, NO_FILTER);
    const risk = groupRows(rows, chapters).find(
      (g) => g.chapter.id === "alt-risk",
    );
    if (!risk) throw new Error("fixture has no alt-risk group");
    expect(risk.rows[0]?.type).toBe("frame");
    // The opening `alt` row said exactly what the header says; the `else` rows
    // under it did not, and they stay.
    const shown = railRows(risk);
    expect(shown).toEqual(risk.rows.slice(1));
    expect(
      shown.filter((r) => r.type === "frame").map((r) => r.keyword),
    ).toEqual(["else", "else"]);
  });

  it("keeps the opening frame row when the filter promoted a different branch", () => {
    const hidden = hiddenStepIds(checkout);
    const rows = buildOutline(checkout, { hidden, crossOnly: true });
    for (const group of groupRows(rows, chapters)) {
      const first = group.rows[0];
      if (group.chapter.kind === "steps" || first?.type !== "frame") continue;
      // Whatever survives, the condition heading the frame is on screen: either
      // the header says it, or the row does.
      const shown = railRows(group);
      const headed =
        first.title === group.chapter.title
          ? group.chapter.title
          : shown[0]?.type === "frame"
            ? shown[0].title
            : undefined;
      expect(headed).toBe(first.title ?? group.chapter.title);
    }
  });

  it("does not rename or renumber chapters when the filter changes", () => {
    const hidden = hiddenStepIds(checkout);
    const filtered = groupRows(
      buildOutline(checkout, { hidden, crossOnly: true }),
      chapters,
    );
    for (const { chapter } of filtered) {
      const original = chapters.find((c) => c.id === chapter.id);
      expect(chapter.title).toBe(original?.title);
      expect(chapter.from).toBe(original?.from);
      expect(chapter.to).toBe(original?.to);
    }
  });
});
