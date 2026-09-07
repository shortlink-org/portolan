// What ⌘K offers before anything is typed: where the reader has been, and
// what they have kept.
//
// The trail and the pins already answer both questions, in the chrome. The
// palette is where a reader's hands already are, though, and "back to the
// event I was on" as two keystrokes from anywhere is a different thing from
// the same chip in a strip they would have to find with the mouse.
//
// Both stores hold ids, and the rows here are the palette's own rows found
// by those ids - so a visit to a renamed event shows the new name, and one to
// a deleted event shows nothing, exactly as the trail and the pin list do.

import type { Pin } from "./pins";
import type { PaletteHit, PaletteItem } from "./palette";
import type { Visit } from "../trail/model";

export interface PaletteSection {
  title: "recent" | "pinned";
  hits: PaletteHit[];
}

/** Rows by the id a visit or a pin would name them with. */
export function itemsById(items: readonly PaletteItem[]): Map<string, PaletteItem> {
  const byId = new Map<string, PaletteItem>();
  for (const item of items) {
    // Selectable rows are named by what they select; the rest by their own
    // id. A row's own id goes in too when nothing has claimed it, so a pin
    // on an ADR and a visit to a flow both find their row.
    if (item.selectId && !byId.has(item.selectId)) byId.set(item.selectId, item);
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return byId;
}

/** The row a visit stands for: its selection when it had one, else its page. */
function itemOfVisit(
  visit: Visit,
  byId: Map<string, PaletteItem>,
  byPath: Map<string, PaletteItem>,
): PaletteItem | null {
  if (visit.selection) {
    const item = byId.get(visit.selection.id);
    if (item) return item;
  }
  return byPath.get(visit.path) ?? null;
}

/**
 * The sections for an empty query. Recent first, newest at the top; then the
 * pins, minus any row already in the recent list. A section with nothing in
 * it is left out, and a reader with neither gets an empty list - the palette
 * falls back to its full index for them.
 */
export function recentSections(
  visits: readonly Visit[],
  pins: readonly Pin[],
  items: readonly PaletteItem[],
  currentPath: string,
): PaletteSection[] {
  const byId = itemsById(items);
  const byPath = new Map<string, PaletteItem>();
  for (const item of items) {
    if (item.path && !byPath.has(item.path)) byPath.set(item.path, item);
  }

  const seen = new Set<PaletteItem>();
  const recent: PaletteHit[] = [];
  for (const visit of visits) {
    // The page the reader is on is not somewhere to go back to - unless the
    // visit is to something selected on it, which they may have cleared.
    if (visit.path === currentPath && !visit.selection) continue;
    const item = itemOfVisit(visit, byId, byPath);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    recent.push({ item });
  }

  const pinned: PaletteHit[] = [];
  for (const pin of pins) {
    const item = byId.get(pin.id);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    pinned.push({ item });
  }

  const sections: PaletteSection[] = [];
  if (recent.length > 0) sections.push({ title: "recent", hits: recent });
  if (pinned.length > 0) sections.push({ title: "pinned", hits: pinned });
  return sections;
}
