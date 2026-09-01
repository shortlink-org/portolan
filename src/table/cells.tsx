// How a cell of each type is drawn.
//
// The point of declaring a column's type is that this file is the only place
// that decides what the type looks like. A date is relative on screen and
// absolute on hover everywhere; an id is copyable everywhere; a version is
// tabular everywhere. Nothing downstream gets to disagree.

import { Link } from "react-router";
import type { ReactNode } from "react";
import type { Status } from "../catalog";
import type { Kind } from "../lib/kinds";
import { KIND_LABEL } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import { StatusChip } from "../components/primitives";
import { Ident } from "../components/Ident";
import { absoluteTime, middleTruncate, relativeTime } from "../lib/format";
import type { CellValue, ColumnType } from "./types";
import { cellText } from "./types";

const STATUSES = new Set<string>(["verified", "declared", "unresolved"]);
const KINDS = new Set<string>([
  "context",
  "service",
  "aggregate",
  "event",
  "vo",
  "entity",
  "command",
  "query",
  "def",
  "flow",
  "adr",
]);

/**
 * How wide a mono cell gets before its middle is dropped. Narrower than the
 * default in format.ts: a table column has less room than a line of prose,
 * and the full value is one hover away.
 */
const MONO_MAX = 32;

/** A date the reader can read, with the timestamp they can quote on hover. */
function DateCell({ iso }: { iso: string }) {
  const absolute = absoluteTime(iso);
  return (
    <time dateTime={iso} title={absolute} className="whitespace-nowrap">
      {relativeTime(iso)}
    </time>
  );
}

/**
 * The default cell for a type. A column that passes its own `cell` never
 * reaches here; everything else does, which is what makes the types worth
 * declaring.
 */
export function defaultCell(
  type: ColumnType,
  value: CellValue,
  href?: string | null,
): ReactNode {
  // The empty cell is a dash, not a blank: a blank reads as a layout bug.
  if (value === undefined) return <span className="text-muted">—</span>;
  const text = cellText(value);

  switch (type) {
    case "mono":
      return (
        <Ident value={text} className="text-muted">
          {middleTruncate(text, MONO_MAX)}
        </Ident>
      );

    case "number":
      return <span className="tnum">{text}</span>;

    case "version":
      return <span className="mono">{text}</span>;

    case "date":
      return <DateCell iso={text} />;

    case "status":
      // A column typed `status` can still hold a word from another vocabulary
      // - an ADR status, say. Those get the plain text rather than a chip
      // that would paint them with a meaning they do not have.
      return STATUSES.has(text) ? (
        <StatusChip status={text as Status} />
      ) : (
        <span className="mono text-muted">{text}</span>
      );

    case "kind":
      return KINDS.has(text) ? (
        <span className="mono inline-flex items-center gap-1.5 text-muted">
          <KindIcon kind={text as Kind} />
          {KIND_LABEL[text as Kind]}
        </span>
      ) : (
        <span className="mono text-muted">{text}</span>
      );

    case "count":
      // A count is a promise that the things counted are somewhere. When the
      // column says where, the number is the way in.
      return href ? (
        <Link to={href} className="tnum rounded-control text-accent hover:underline">
          {text}
        </Link>
      ) : (
        <span className="tnum">{text}</span>
      );

    case "text":
      return <span>{text}</span>;
  }
}
