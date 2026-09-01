// The author's say over a table in a README.
//
// Enhancement is the default because a README table is usually a list someone
// would like to sort. It is not always: a two-column key/value block, or a
// table whose row order IS the content, is worse for being made interactive.
// So there is an escape hatch, and it is an HTML comment - the one thing that
// can sit in a markdown file, mean something here, and remain invisible
// everywhere else the file is read.
//
//   <!-- table: static -->            render it as written, no toolbar, no sort
//   <!-- table: sort=name.desc -->    open it sorted, by column id and direction

/** The attribute the remark plugin leaves on a table for the renderer to find. */
export const TABLE_DIRECTIVE_ATTR = "data-table";

const COMMENT_RE = /^<!--\s*table:\s*(.*?)\s*-->$/;

export interface TableDirective {
  /** Render as written: this table is not a list, it is a layout. */
  static: boolean;
  /** Column id and direction, as `<id>.asc` or `<id>.desc`. */
  sort: { id: string; desc: boolean } | null;
}

export const NO_DIRECTIVE: TableDirective = { static: false, sort: null };

/**
 * Reads the body of a `table:` comment. Returns null for a comment that is not
 * one of ours, so an ordinary HTML comment above a table stays an ordinary
 * HTML comment.
 */
export function parseTableComment(raw: string): string | null {
  const match = COMMENT_RE.exec(raw.trim());
  return match ? (match[1] ?? "") : null;
}

/** Reads the directive body. An unrecognised word is ignored, never fatal. */
export function parseTableDirective(body: string): TableDirective {
  const directive: TableDirective = { static: false, sort: null };
  for (const term of body.split(/\s+/)) {
    if (term === "") continue;
    if (term === "static") {
      directive.static = true;
      continue;
    }
    const sort = /^sort=(.+)\.(asc|desc)$/.exec(term);
    if (sort?.[1]) directive.sort = { id: sort[1], desc: sort[2] === "desc" };
  }
  return directive;
}

/** A column id from a header cell: what the `sort=` directive names. */
export function columnSlug(header: string, taken: Set<string>): string {
  const base =
    header
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "col";
  if (!taken.has(base)) return base;
  // Two columns headed the same is a bad table, not an error. Number them.
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// --- The remark half -------------------------------------------------------

interface Node {
  type: string;
  value?: string;
  data?: { hProperties?: Record<string, string> };
  children?: Node[];
}

/**
 * Attaches a `table:` comment to the table it introduces. remark leaves the
 * comment as an `html` node and react-markdown drops it, so without this the
 * directive would be invisible to the component that has to obey it.
 *
 * "Introduces" means the node immediately before, at the same level - which
 * is the only place an author would think to write it.
 */
export function remarkTableDirective() {
  return (tree: Node): void => {
    const walk = (node: Node): void => {
      const children = node.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!child) continue;
        walk(child);
        if (child.type !== "table") continue;
        const previous = children[i - 1];
        if (!previous || previous.type !== "html") continue;
        const body = parseTableComment(previous.value ?? "");
        if (body === null) continue;
        child.data = child.data ?? {};
        child.data.hProperties = {
          ...child.data.hProperties,
          [TABLE_DIRECTIVE_ATTR]: body,
        };
      }
    };
    walk(tree);
  };
}
