import { describe, expect, it } from "vitest";
import { catalog } from "../testing/estate";
import { paletteItems } from "./palette";
import { itemsById, recentSections } from "./palette-recent";
import type { Visit } from "../trail/model";

const items = paletteItems(catalog);
const event = items.find((i) => i.kind === "event" && i.selectId && i.path)!;
const service = items.find((i) => i.kind === "service" && i.path)!;
const flow = items.find((i) => i.kind === "flow" && i.path)!;
const adr = items.find((i) => i.kind === "adr" && i.path)!;

const visit = (path: string, id?: string): Visit => ({
  path,
  selection: id ? { kind: "unknown", id } : null,
});

describe("itemsById", () => {
  it("finds a selectable row by what it selects, and any row by its id", () => {
    const byId = itemsById(items);
    expect(byId.get(event.selectId!)).toBe(event);
    expect(byId.get(flow.id)).toBe(flow);
    expect(byId.get(adr.id)).toBe(adr);
  });
});

describe("recentSections", () => {
  it("is empty for a reader with no trail and no pins", () => {
    expect(recentSections([], [], items, "/")).toEqual([]);
  });

  it("turns visits into rows, newest first, by selection or by page", () => {
    const visits = [
      visit(service.path!, event.selectId),
      visit(flow.path!),
      visit(adr.path!),
    ];
    const [recent] = recentSections(visits, [], items, "/");
    expect(recent?.title).toBe("recent");
    expect(recent?.hits.map((h) => h.item)).toEqual([event, flow, adr]);
  });

  it("leaves out the page the reader is standing on", () => {
    const visits = [visit(flow.path!), visit(service.path!)];
    const [recent] = recentSections(visits, [], items, flow.path!);
    expect(recent?.hits.map((h) => h.item)).toEqual([service]);
  });

  it("keeps a visit to the current page when something was selected on it", () => {
    const visits = [visit(service.path!, event.selectId)];
    const [recent] = recentSections(visits, [], items, service.path!);
    expect(recent?.hits.map((h) => h.item)).toEqual([event]);
  });

  it("drops a visit to something the catalog no longer has", () => {
    const visits = [visit("/c/nope/gone"), visit(flow.path!, "nope.gone.Event")];
    expect(recentSections(visits, [], items, "/")).toEqual([
      { title: "recent", hits: [{ item: flow }] },
    ]);
  });

  it("lists pins after the trail, minus what the trail already shows", () => {
    const visits = [visit(service.path!, event.selectId)];
    const pins = [
      { kind: "event" as const, id: event.selectId! },
      { kind: "service" as const, id: service.selectId ?? service.id },
    ];
    const sections = recentSections(visits, pins, items, "/");
    expect(sections.map((s) => s.title)).toEqual(["recent", "pinned"]);
    expect(sections[0]?.hits.map((h) => h.item)).toEqual([event]);
    expect(sections[1]?.hits.map((h) => h.item)).toEqual([service]);
  });

  it("offers only the pins when there is no trail", () => {
    const pins = [{ kind: "flow" as const, id: flow.id }];
    expect(recentSections([], pins, items, "/")).toEqual([
      { title: "pinned", hits: [{ item: flow }] },
    ]);
  });
});
