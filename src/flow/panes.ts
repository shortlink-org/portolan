// What is open beside the flow, and in what order.
//
// A flow stops where its service stops, and the step that calls the next one
// says which flow answers it (`continues.ts`). Reading that answer used to
// mean leaving the page; then it meant unfolding the other flow's steps into
// this one's rail, which read well and drew badly - a picture has to be laid
// out, and a path assembled while reading is a shape nobody laid out.
//
// So a followed flow is opened as a document of its own: its own rail, its
// own canvas, drawn by the view it already has. Nothing is composed, nothing
// is generated, and the reader can have several open at once - the way an
// editor holds several files.
//
// A pane is named by the door it was opened through, `<step id>><flow slug>`,
// and a door inside an opened pane is named from its pane, so the name says
// the whole chain: `s2>auth-validate-session/t4>ledger-authorize`. That is
// what the address carries, so a link opens what the sender had open.

import type { Flow } from "../catalog.ts";
import type { Continuation } from "./continues.ts";

export interface Pane {
  /** The door this was opened through; unique among what is open. */
  key: string;
  flow: Flow;
  /** The pane this one was opened from, or null for one opened from the page. */
  parent: string | null;
}

/** The flow a door leads to: the slug after the last `>`. */
export function paneSlug(key: string): string {
  const last = key.slice(key.lastIndexOf(">") + 1);
  return last;
}

/** The pane a door was opened from, or null when it was opened from the page. */
export function paneParent(key: string): string | null {
  const cut = key.lastIndexOf("/");
  return cut < 0 ? null : key.slice(0, cut);
}

/** The door key for a step of a pane, or of the page when `pane` is null. */
export function doorKey(pane: string | null, stepId: string, via: Continuation): string {
  const door = `${stepId}>${via.slug}`;
  return pane ? `${pane}/${door}` : door;
}

/** What `?open=` carries: the keys in the order they were opened. */
export function readPanes(param: string | null): string[] {
  return (param ?? "").split(",").map((key) => key.trim()).filter(Boolean);
}

export function writePanes(keys: readonly string[]): string {
  return keys.join(",");
}

/** Opened last is shown last: a reader following a path reads downwards. */
export function openPane(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? [...keys] : [...keys, key];
}

/**
 * Closing a document closes what was opened from it. Those panes are named
 * from this one, so they would otherwise stay open with nothing above them -
 * and the address would open them again next time.
 */
export function closePane(keys: readonly string[], key: string): string[] {
  return keys.filter((open) => open !== key && !open.startsWith(`${key}/`));
}

/**
 * The documents, resolved against the catalog and in the order they were
 * opened. A key naming a flow the catalog does not have is dropped: a link
 * from an older catalog opens what it still can rather than nothing.
 */
export function panesOf(keys: readonly string[], flows: readonly Flow[]): Pane[] {
  const bySlug = new Map(flows.map((flow) => [flow.slug, flow]));
  const out: Pane[] = [];
  for (const key of keys) {
    const flow = bySlug.get(paneSlug(key));
    if (!flow) continue;
    const parent = paneParent(key);
    // A pane whose parent is closed is closed too: it was read through it.
    if (parent && !out.some((open) => open.key === parent)) continue;
    out.push({ key, flow, parent });
  }
  return out;
}

/**
 * The document a rail row belongs to. A row's key is the chain of doors it was
 * read through, so its document is the open key the chain starts with - the
 * longest one, because a document opened from a document carries the shorter
 * key as its own prefix. Null for a row of the flow on the page.
 */
export function paneOfRow(keys: readonly string[], rowKey: string): string | null {
  let found: string | null = null;
  for (const key of keys) {
    if (rowKey.startsWith(`${key}/`) && (found === null || key.length > found.length)) found = key;
  }
  return found;
}

/** Whether this door is open, for the row that offers it. */
export function isOpen(keys: readonly string[], key: string): boolean {
  return keys.includes(key);
}
