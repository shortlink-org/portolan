// One selection, globally, for the whole app.
//
// Every panel that can be clicked writes here; every panel that has to react
// reads here. Nothing else holds a "what is selected" of its own, so there is
// no pair of panels that can disagree.

import { create } from "zustand";
import type { Selection, SelectionSource } from "./model";
import { sameSelection, selectionFor } from "./model";

export interface SelectionState {
  selection: Selection | null;
  /** Which panel wrote the current value. Never part of identity. */
  source: SelectionSource | null;
  /** Selects by catalog id; the kind is derived, never passed in. */
  select: (id: string, source: SelectionSource) => void;
  /** Selects a value that already carries its kind (parsed from a URL). */
  set: (selection: Selection | null, source: SelectionSource) => void;
  clear: (source: SelectionSource) => void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selection: null,
  source: null,
  select: (id, source) => set(next(selectionFor(id), source)),
  set: (selection, source) => set(next(selection, source)),
  clear: (source) => set(next(null, source)),
}));

/**
 * Re-selecting the same entity from the same panel is a no-op, so a diagram
 * that echoes its own click back cannot start a render loop. Re-selecting it
 * from a *different* panel still updates `source`, because that is exactly the
 * fact the diagram needs in order to decide whether to mark its canvas.
 */
function next(selection: Selection | null, source: SelectionSource) {
  return (state: SelectionState): Partial<SelectionState> => {
    if (sameSelection(state.selection, selection) && state.source === source) {
      return state;
    }
    return { selection, source };
  };
}

export const useSelection = (): Selection | null =>
  useSelectionStore((s) => s.selection);

export const useSelectionSource = (): SelectionSource | null =>
  useSelectionStore((s) => s.source);

export const useSelect = (): SelectionState["select"] =>
  useSelectionStore((s) => s.select);

export const useClearSelection = (): SelectionState["clear"] =>
  useSelectionStore((s) => s.clear);

/** True when `id` is the current selection. Cheap enough for every tree row. */
export const useIsSelected = (id: string): boolean =>
  useSelectionStore((s) => s.selection?.id === id);
