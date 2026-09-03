// Pinning, everywhere it is offered.
//
// The store holds kinds and ids; `resolvePin` turns one back into a row the
// tree can draw. Resolution happening at render rather than at pin time is the
// whole point: a pin survives a rebuild that renamed the event, and quietly
// stops resolving when the event is gone, rather than pointing at a page the
// catalog no longer has.

import { Pin as PinIcon, PinOff } from "lucide-react";
import { create } from "zustand";
import { catalog, index } from "../data";
import { adrNumber } from "../lib/adr";
import { flowOwner } from "../lib/flow-tree";
import { addPin, isPinned, movePin, removePin } from "../lib/pins";
import type { Pin, PinKind } from "../lib/pins";
import { readPins, writePins } from "../lib/sidebar-prefs";
import type { Kind } from "../lib/kinds";
import {
  adrPath,
  aggregatePath,
  eventPath,
  modulePath,
  paths,
  servicePath,
  tablePath,
} from "../routes";
import { useToastStore } from "./toast";

interface PinsState {
  pins: Pin[];
  toggle: (pin: Pin) => void;
  reorder: (from: number, to: number) => void;
}

export const usePinsStore = create<PinsState>()((set, get) => ({
  pins: readPins(),
  toggle: (pin) => {
    const current = get().pins;
    if (isPinned(current, pin)) {
      const next = removePin(current, pin);
      writePins(next);
      set({ pins: next });
      return;
    }
    const { pins: next, evicted } = addPin(current, pin);
    writePins(next);
    set({ pins: next });
    if (evicted) {
      const gone = resolvePin(evicted);
      useToastStore
        .getState()
        .say(`pinned — ${gone?.name ?? evicted.id} was unpinned to make room`);
    }
  },
  reorder: (from, to) => {
    const next = movePin(get().pins, from, to);
    writePins(next);
    set({ pins: next });
  },
}));

/** True while this exact thing is on the list. Re-renders only when it flips. */
export function useIsPinned(pin: Pin | null): boolean {
  return usePinsStore((s) => (pin ? isPinned(s.pins, pin) : false));
}

export interface ResolvedPin {
  pin: Pin;
  /** The kind's icon in the shared taxonomy, which is not always the pin kind. */
  kind: Kind;
  name: string;
  /** What the row is titled with - the catalog id, as it is spelled. */
  title: string;
  path: string;
  contextId: string | null;
}

/**
 * A pin, as a row. Null when the catalog no longer has what was pinned: the
 * tree drops the row rather than drawing a name with nowhere to go.
 */
export function resolvePin(pin: Pin): ResolvedPin | null {
  const base = { pin, title: pin.id };
  switch (pin.kind) {
    case "flow": {
      const flow = catalog.flows.find((f) => f.id === pin.id);
      if (!flow) return null;
      return {
        ...base,
        kind: "flow",
        name: flow.name,
        title: flow.slug,
        path: paths.flow(flow.slug),
        contextId: flowOwner(flow),
      };
    }
    case "event": {
      const event = index.eventById.get(pin.id);
      const owner = index.eventOwner.get(pin.id);
      const to = eventPath(pin.id);
      if (!event || !owner || !to) return null;
      return {
        ...base,
        kind: "event",
        name: event.name,
        path: to,
        contextId: index.serviceContext.get(owner.service.id)?.id ?? null,
      };
    }
    case "adr": {
      const adr = index.adrById.get(pin.id);
      const to = adrPath(pin.id);
      if (!adr || !to) return null;
      return {
        ...base,
        kind: "adr",
        name: `${adrNumber(adr).replace(/^ADR-/, "")}  ${adr.title}`,
        path: to,
        contextId: adr.scope.kind === "context" ? adr.scope.context : null,
      };
    }
    case "module": {
      const module = index.moduleById.get(pin.id);
      const to = modulePath(pin.id);
      if (!module || !to) return null;
      return {
        ...base,
        kind: "module",
        name: module.name,
        path: to,
        // A module belongs to no single context: it is published by one
        // service and read by four, which is why it has no context colour.
        contextId: null,
      };
    }
    case "service": {
      const service = index.serviceById.get(pin.id);
      const to = servicePath(pin.id);
      if (!service || !to) return null;
      return {
        ...base,
        kind: "service",
        name: service.name,
        path: to,
        contextId: index.serviceContext.get(pin.id)?.id ?? null,
      };
    }
    case "aggregate": {
      const aggregate = index.aggregateById.get(pin.id);
      const owner = index.aggregateOwner.get(pin.id);
      const to = aggregatePath(pin.id);
      if (!aggregate || !owner || !to) return null;
      return {
        ...base,
        kind: "aggregate",
        name: aggregate.name,
        path: to,
        contextId: index.serviceContext.get(owner.id)?.id ?? null,
      };
    }
    case "table": {
      const held = index.tableById.get(pin.id);
      const to = tablePath(pin.id);
      if (!held || !to) return null;
      return {
        ...base,
        kind: "table",
        name: held.table.name,
        path: to,
        contextId: index.serviceContext.get(held.store.owner)?.id ?? null,
      };
    }
  }
}

/**
 * The pin control, and the only one. It says what it will do rather than what
 * the state is - "Pin" / "Unpin" - because a filled pin icon on its own reads
 * as decoration on a page a reader has never pinned.
 */
export function PinButton({
  kind,
  id,
  label,
  size = 16,
}: {
  kind: PinKind;
  id: string;
  /** What the tooltip names, when the catalog id is not what a reader calls it. */
  label?: string;
  size?: number;
}) {
  const pin: Pin = { kind, id };
  const pinned = useIsPinned(pin);
  const toggle = usePinsStore((s) => s.toggle);
  const what = label ?? id;
  const title = pinned
    ? `Unpin ${what}`
    : `Pin ${what} to the top of the catalog`;
  return (
    <button
      type="button"
      onClick={() => toggle(pin)}
      aria-pressed={pinned}
      aria-label={title}
      title={title}
      className={`flex size-7 shrink-0 items-center justify-center rounded-control t-micro transition-colors hover:bg-surface ${
        pinned ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {pinned ? (
        <PinOff size={size} aria-hidden />
      ) : (
        <PinIcon size={size} aria-hidden />
      )}
    </button>
  );
}
