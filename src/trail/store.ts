// The journal itself: the last few entities the reader stood in front of.
//
// Most recent first, one slot per page, seven slots. Seven is not a round
// number picked for looks — it is about as many names as a reader can scan
// without reading, and a strip longer than that stops being a glance and
// becomes another list to search.

import { create } from "zustand";
import { sameSelection, selectionFor } from "../selection/model";
import type { Selection } from "../selection/model";
import type { Visit } from "./model";
import { sameVisit } from "./model";

export const MAX_VISITS = 7;

const KEY = "portolan.trail";

interface TrailState {
  /** Newest first. */
  visits: Visit[];
  record: (visit: Visit) => void;
  clear: () => void;
}

export const useTrailStore = create<TrailState>()((set) => ({
  visits: load(),
  record: (visit) =>
    set((state) => {
      const head = state.visits[0];
      // Nothing moved: the same page with the same thing selected on it. The
      // whole state object is returned so zustand notifies nobody.
      if (
        head &&
        sameVisit(head, visit) &&
        sameSelection(head.selection, visit.selection)
      ) {
        return state;
      }
      return {
        visits: [
          visit,
          ...state.visits.filter((v) => !sameVisit(v, visit)),
        ].slice(0, MAX_VISITS),
      };
    }),
  clear: () => set({ visits: [] }),
}));

/**
 * The trail is per tab and per session: a reader who opens a second tab to
 * compare two contexts is on a second thread of thought, and neither tab
 * should be writing into the other's journal. sessionStorage is exactly that
 * scope, and it is also why a reload keeps the trail while tomorrow does not.
 */
useTrailStore.subscribe((state) => save(state.visits));

function load(): Visit[] {
  const raw = read();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(toVisit).slice(0, MAX_VISITS);
  } catch {
    return []; // hand-edited or half-written: start empty, say nothing
  }
}

/**
 * Storage is a text field anyone can edit, so every field is checked. The
 * selection's kind is re-derived rather than trusted: a stored `event` whose
 * id is now a value object would otherwise put the wrong icon on the chip.
 */
function toVisit(value: unknown): Visit[] {
  if (typeof value !== "object" || value === null) return [];
  const { path, selection } = value as { path?: unknown; selection?: unknown };
  if (typeof path !== "string" || !path.startsWith("/")) return [];
  return [{ path, selection: toSelection(selection) }];
}

function toSelection(value: unknown): Selection | null {
  if (typeof value !== "object" || value === null) return null;
  const { id } = value as { id?: unknown };
  if (typeof id !== "string" || !id) return null;
  return selectionFor(id);
}

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null; // no storage, or a private mode that refuses it
  }
}

function save(visits: Visit[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(visits));
  } catch {
    /* this session still keeps its trail, it just does not survive a reload */
  }
}
