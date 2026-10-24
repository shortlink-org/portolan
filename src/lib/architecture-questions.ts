import { LINKS_HERE, SERVICE_ANCHOR, paths } from "../routes";
import { search } from "./palette";
import type { PaletteItem, PaletteResult } from "./palette";

export interface ArchitectureQuestion {
  label: string;
  result?: PaletteResult;
  action?: { label: string; path: string };
}

function subject(raw: string, pattern: RegExp): string | null {
  const matched = pattern.exec(raw.trim().replace(/\?$/, ""));
  return matched ? (matched[1] ?? "").trim() : null;
}

function retarget(
  items: readonly PaletteItem[],
  term: string,
  kind: PaletteItem["kind"],
  destination: (item: PaletteItem) => string | null,
): PaletteResult {
  const result = search(items.filter((item) => item.kind === kind), term);
  return {
    ...result,
    hits: result.hits.map((hit) => ({
      ...hit,
      item: {
        ...hit.item,
        path: destination(hit.item),
        selectId: undefined,
      },
    })),
  };
}

/** Natural-language shortcuts for the architectural questions readers repeat. */
export function architectureQuestion(
  items: readonly PaletteItem[],
  raw: string,
): ArchitectureQuestion | null {
  const normalized = raw.trim().replace(/\?$/, "").toLowerCase();
  if (/^(show\s+)?unresolved(\s+relationships?)?$/.test(normalized)) {
    return {
      label: "Unresolved relationships",
      action: { label: "Open unresolved relationships", path: paths.problems() },
    };
  }

  const callers = subject(raw, /^who\s+calls\s+(.+)$/i);
  if (callers !== null) {
    return {
      label: `Who calls ${callers}?`,
      result: retarget(items, callers, "service", (item) =>
        item.path ? `${item.path}#${LINKS_HERE}` : null,
      ),
    };
  }

  const deployed = subject(raw, /^where\s+(?:is|does)\s+(.+?)(?:\s+deployed|\s+run)?$/i);
  if (deployed !== null) {
    return {
      label: `Where does ${deployed} run?`,
      result: retarget(items, deployed, "service", (item) =>
        item.path ? `${item.path}#${SERVICE_ANCHOR.runtime}` : null,
      ),
    };
  }

  const publishes = subject(raw, /^what\s+does\s+(.+?)\s+publish$/i);
  if (publishes !== null) {
    return {
      label: `What does ${publishes} publish?`,
      result: retarget(items, publishes, "service", (item) =>
        item.path ? `${item.path}#${SERVICE_ANCHOR.events}` : null,
      ),
    };
  }

  const publisher = subject(raw, /^what\s+publishes\s+(.+)$/i);
  if (publisher !== null) {
    return {
      label: `What publishes ${publisher}?`,
      result: retarget(items, publisher, "event", (item) => item.path),
    };
  }

  return null;
}
