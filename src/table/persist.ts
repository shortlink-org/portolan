// What a table remembers about itself.
//
// Column widths and hidden columns are per table id, because they are answers
// to "what am I looking at" rather than a global preference: a reader who
// widened the title column on the decisions index has said nothing about the
// schema table on an event page. Zebra striping is the opposite - it is a
// statement about tables in general - so it is stored once.
//
// localStorage is a thing that fails: private mode throws on write, and what
// comes back was last written by an older build, or by hand. Everything here
// treats a bad read as no read.

const TABLE_KEY = (id: string) => `portolan.table.${id}`;
const ZEBRA_KEY = "portolan.table.zebra";

export interface TableMemory {
  /** Column id to dragged width in px. */
  sizing: Record<string, number>;
  /** Column ids the reader has switched off. */
  hidden: string[];
}

export const EMPTY_MEMORY: TableMemory = { sizing: {}, hidden: [] };

/** Reads whatever is in storage into the shape the table expects, or nothing. */
export function parseMemory(raw: string | null): TableMemory {
  if (!raw) return EMPTY_MEMORY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_MEMORY;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_MEMORY;
  const record = parsed as { sizing?: unknown; hidden?: unknown };

  const sizing: Record<string, number> = {};
  if (typeof record.sizing === "object" && record.sizing !== null) {
    for (const [id, width] of Object.entries(record.sizing)) {
      // A width that is not a positive number is not a width.
      if (typeof width === "number" && Number.isFinite(width) && width > 0) {
        sizing[id] = width;
      }
    }
  }

  const hidden = Array.isArray(record.hidden)
    ? record.hidden.filter((id): id is string => typeof id === "string")
    : [];

  return { sizing, hidden };
}

export function serializeMemory(memory: TableMemory): string {
  return JSON.stringify(memory);
}

export function readMemory(tableId: string): TableMemory {
  try {
    return parseMemory(localStorage.getItem(TABLE_KEY(tableId)));
  } catch {
    return EMPTY_MEMORY;
  }
}

export function writeMemory(tableId: string, memory: TableMemory): void {
  try {
    localStorage.setItem(TABLE_KEY(tableId), serializeMemory(memory));
  } catch {
    /* private mode: this session still resizes, it just does not persist */
  }
}

export function readZebra(): boolean {
  try {
    return localStorage.getItem(ZEBRA_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeZebra(on: boolean): void {
  try {
    localStorage.setItem(ZEBRA_KEY, on ? "on" : "off");
  } catch {
    /* see above */
  }
}

/**
 * TanStack's visibility state, from the list of ids the reader switched off.
 * Only an explicit `false` hides a column; a column that is absent is shown,
 * which is why this cannot be built by listing what IS visible.
 */
export function visibilityOf(hidden: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(hidden.map((id) => [id, false]));
}

/** The inverse, for writing back. */
export function hiddenOf(visibility: Record<string, boolean>): string[] {
  return Object.entries(visibility)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id);
}
