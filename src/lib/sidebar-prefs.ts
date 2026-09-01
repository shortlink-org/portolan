// What the sidebar remembers between sessions.
//
// Three things, and all three are the reader's answer to "what do I not want
// to look at right now": which sections are folded, which owner groups inside
// FLOWS are folded, and which pins they keep. Everything else about the tree -
// which context is open, which aggregate - is a working state that follows the
// selection, and a tree that reopened yesterday's branches on load would fight
// the selection it was given.
//
// Same rule as table/persist.ts: localStorage is a thing that fails, and a bad
// read is treated as no read.

import { parsePins, serializePins } from "./pins";
import type { Pin } from "./pins";

export const SECTIONS_KEY = "portolan.sidebar.sections";
export const FLOW_GROUPS_KEY = "portolan.sidebar.flow-groups";
export const PINS_KEY = "portolan.sidebar.pins";

/** A set of named booleans - "is this section folded" - and nothing else. */
export type Flags = Record<string, boolean>;

export function parseFlags(raw: string | null): Flags {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const out: Flags = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function serializeFlags(flags: Flags): string {
  return JSON.stringify(flags);
}

export function readFlags(key: string): Flags {
  try {
    return parseFlags(localStorage.getItem(key));
  } catch {
    return {};
  }
}

export function writeFlags(key: string, flags: Flags): void {
  try {
    localStorage.setItem(key, serializeFlags(flags));
  } catch {
    /* private mode: this session still folds, it just does not remember */
  }
}

export function readPins(): Pin[] {
  try {
    return parsePins(localStorage.getItem(PINS_KEY));
  } catch {
    return [];
  }
}

export function writePins(pins: Pin[]): void {
  try {
    localStorage.setItem(PINS_KEY, serializePins(pins));
  } catch {
    /* see above */
  }
}
