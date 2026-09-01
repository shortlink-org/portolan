// Selection lives in the URL, so a selected event survives a reload and can be
// pasted into a chat message. The route says which page; the hash says what is
// selected on it. They are independent, and the hash is written with `replace`
// so cycling through steps does not fill the back stack.

import type { Selection, SelectionKind } from "./model";
import { classify } from "./model";

const KINDS: SelectionKind[] = [
  "context",
  "service",
  "aggregate",
  "store",
  "table",
  "column",
  "event",
  "value-object",
  "flow-step",
  "unknown",
];

/** "sel=event:shop.oms.cart.ItemAdded" — no leading "#". */
export function encodeSelection(selection: Selection): string {
  return `sel=${selection.kind}:${encodeURIComponent(selection.id)}`;
}

export function selectionHash(selection: Selection | null): string {
  return selection ? `#${encodeSelection(selection)}` : "";
}

/**
 * Parses a location hash back into a selection. The kind in the URL is a hint
 * only: the catalog is re-consulted, so a link written before an event moved
 * still lands on the right kind of thing — or on "unknown" if it is gone.
 */
export function parseSelectionHash(hash: string): Selection | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("sel=")) return null;
  const body = raw.slice(4);
  const at = body.indexOf(":");
  if (at <= 0) return null;

  const declared = body.slice(0, at);
  if (!KINDS.includes(declared as SelectionKind)) return null;

  let id: string;
  try {
    id = decodeURIComponent(body.slice(at + 1));
  } catch {
    return null; // a malformed escape is a broken link, not a crash
  }
  if (!id) return null;

  return { kind: classify(id), id };
}
