// What the reader keeps at the top of the tree.
//
// A pin is a reader's own answer to "where do I keep coming back to", so it is
// stored as nothing but a kind and a catalog id: the name, the icon and the
// route are all read back out of the catalog at render time. A pin taken
// against a build that no longer has that event therefore goes quiet rather
// than pointing at a page that is not there.
//
// Order is the reader's, not the catalog's - pins are dragged into the order
// they think in - so the list is a sequence and never re-sorted.

/**
 * What can be pinned. Not every kind: a column, a shared type or a value
 * object is read inside the thing that holds it, and a pin that lands on a
 * panel three levels deep is a bookmark to a scroll position.
 */
export type PinKind =
  | "flow"
  | "event"
  | "adr"
  | "service"
  | "aggregate"
  | "table";

const PIN_KINDS: readonly PinKind[] = [
  "flow",
  "event",
  "adr",
  "service",
  "aggregate",
  "table",
] as const;

export function isPinKind(value: string): value is PinKind {
  return (PIN_KINDS as readonly string[]).includes(value);
}

export interface Pin {
  kind: PinKind;
  /** The catalog id, spelled the way the catalog spells it. */
  id: string;
}

/**
 * How many pins a reader may keep. Twelve is the last count that still reads
 * as a shortlist above the tree rather than as a second tree; past it the
 * pinned block would push FLOWS off the first screen, which is exactly the
 * harm pinning was meant to undo.
 */
export const PIN_CAP = 12;

export function samePin(a: Pin, b: Pin): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function isPinned(pins: Pin[], pin: Pin): boolean {
  return pins.some((p) => samePin(p, pin));
}

/**
 * Pin something, at the end of the list. At the cap the OLDEST pin goes, not
 * the new one: a reader who pins a thirteenth thing has said what they want on
 * screen, and refusing them would make the cap look like a bug. `evicted` is
 * what they lost, so the caller can say so out loud.
 */
export function addPin(
  pins: Pin[],
  pin: Pin,
): { pins: Pin[]; evicted: Pin | null } {
  if (isPinned(pins, pin)) return { pins, evicted: null };
  const next = [...pins, pin];
  if (next.length <= PIN_CAP) return { pins: next, evicted: null };
  const evicted = next[0] ?? null;
  return { pins: next.slice(next.length - PIN_CAP), evicted };
}

export function removePin(pins: Pin[], pin: Pin): Pin[] {
  return pins.filter((p) => !samePin(p, pin));
}

/** Move the pin at `from` so that it sits at `to`, closing the gap behind it. */
export function movePin(pins: Pin[], from: number, to: number): Pin[] {
  if (from === to) return pins;
  if (from < 0 || from >= pins.length) return pins;
  if (to < 0 || to >= pins.length) return pins;
  const next = [...pins];
  const [moved] = next.splice(from, 1);
  if (!moved) return pins;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Whatever is in storage, read as a pin list. Anything that is not a pin is
 * dropped rather than repaired: what comes back was written by an older build
 * or by hand, and a half-understood entry is worse than one that is gone.
 */
export function parsePins(raw: string | null): Pin[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Pin[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, id } = entry as { kind?: unknown; id?: unknown };
    if (typeof kind !== "string" || typeof id !== "string") continue;
    if (!isPinKind(kind) || id === "") continue;
    const pin = { kind, id };
    if (!isPinned(out, pin)) out.push(pin);
  }
  return out.slice(0, PIN_CAP);
}

export function serializePins(pins: Pin[]): string {
  return JSON.stringify(pins);
}
