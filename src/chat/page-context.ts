// What the reader is looking at when they open Ask the catalog.
//
// The route is navigation context, not evidence. It gives the model a useful
// referent for “this flow” and lets the empty conversation offer questions
// about the thing already on screen. The answer must still read the generated
// markdown page before it claims anything about that thing.

import type { Kind } from "../lib/kinds";
import type { PaletteItem } from "../lib/palette";
import { catalog } from "../data";
import { paletteItems } from "../lib/palette";

export interface ChatPageContext {
  kind: Kind;
  id: string;
  title: string;
  /** Path relative to the profile's docs directory, as llms.txt spells it. */
  docPath: string | null;
}

const items = paletteItems(catalog);

function docsPath(item: PaletteItem): string | null {
  if (!item.path) return null;
  const parts = item.path.split("?")[0]?.split("#")[0]?.split("/").filter(Boolean) ?? [];

  switch (item.kind) {
    case "context":
      return `${item.id}/README.md`;
    case "service":
      return parts.length >= 3 ? `${parts[1]}/${parts[2]}/README.md` : null;
    case "aggregate":
    case "event":
    case "vo":
    case "entity":
    case "enum":
    case "command":
    case "query":
      return parts.length >= 4
        ? `${parts[1]}/${parts[2]}/aggregates/${parts[3]}.md`
        : null;
    case "flow":
      return `flows/${item.name}.md`;
    case "adr":
      return `adr/${item.id}.md`;
    case "external":
      return parts[1] ? `externals/${parts[1]}.md` : null;
    case "module":
      return parts[1] ? `modules/${parts[1]}.md` : null;
    default:
      return null;
  }
}

function titleOf(item: PaletteItem): string {
  if (item.kind === "flow" || item.kind === "adr" || item.kind === "context") {
    return item.detail;
  }
  return item.name;
}

/** The exact catalog entity page at this route, if there is one. */
export function pageContextFrom(
  candidates: readonly PaletteItem[],
  pathname: string,
): ChatPageContext | null {
  const item = candidates.find((candidate) => candidate.path === pathname);
  if (!item) return null;
  return {
    kind: item.kind,
    id: item.id,
    title: titleOf(item),
    docPath: docsPath(item),
  };
}

export function pageContext(pathname: string): ChatPageContext | null {
  return pageContextFrom(items, pathname);
}

/** Questions that use the current page instead of making the reader restate it. */
export function contextQuestions(context: ChatPageContext): string[] {
  const id = context.id;
  switch (context.kind) {
    case "flow":
      return [
        `Summarize ${id} and its trust status.`,
        `Which contexts and services does ${id} cross?`,
        `Which steps in ${id} are declared rather than verified?`,
        `Which decisions explain ${id}?`,
      ];
    case "context":
      return [
        `What does ${id} own?`,
        `Which services and aggregates are inside ${id}?`,
        `Which flows cross the boundary of ${id}?`,
        `Which problems and decisions touch ${id}?`,
      ];
    case "service":
      return [
        `Summarize ${id} and what it owns.`,
        `What does ${id} provide and consume?`,
        `Which flows pass through ${id}?`,
        `Which decisions and problems touch ${id}?`,
      ];
    case "aggregate":
      return [
        `Summarize the invariants of ${id}.`,
        `Show the lifecycle of ${id}.`,
        `Which commands, queries and events belong to ${id}?`,
        `Which flows change ${id}?`,
      ];
    case "adr":
      return [
        `Summarize ${id} and its consequences.`,
        `Which parts of the catalog does ${id} affect?`,
        `Which flows are explained by ${id}?`,
        `What evidence supports ${id}?`,
      ];
    default:
      return [
        `Summarize ${id}.`,
        `What is connected to ${id}?`,
        `Which flows touch ${id}?`,
        `Which decisions and problems touch ${id}?`,
      ];
  }
}
