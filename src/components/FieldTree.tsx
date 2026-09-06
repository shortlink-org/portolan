// The fields of a shape, and the shapes inside those fields, as far down as
// the catalog can see.
//
// A schema table shows one level: the event's own fields. Under a field
// whose type is a value object or an entity there is another shape, and under
// its `unit_price` another. This draws that descent as a tree, each level one
// step in from the last, with a guide line so the eye can find its way back
// up, and a header per shape saying what it is and where its page is.
//
// State is a set of dotted paths - `items`, `items.unit_price` - held by the
// page, not here. The page owns "expand all", and a tree that kept its own
// state would forget it every time the table re-sorted a row out and back.

import { Link } from "react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Field } from "../catalog";
import { catalog } from "../data";
import { KIND_LABEL } from "../lib/kinds";
import { plural } from "../lib/format";
import { parseType, resolveShape, scopeOf, MAX_DEPTH } from "../lib/shape";
import type { Scope, Shape } from "../lib/shape";
import { blockPath } from "../routes";
import { Ident } from "./Ident";
import { KindIcon } from "./kind";

/** The words the type chip uses for what `parseType` found. */
const CARDINALITY: Record<"many" | "map", string> = {
  many: "list of",
  map: "map of",
};

/**
 * The type of a field, as a reader wants it: the raw spelling to copy, a
 * word for the wrapper it is in, and a way to the page of the shape it
 * names. Shared by the table cell and the tree row so both say it the same.
 */
export function TypeCell({
  field,
  shape,
  muted = true,
}: {
  field: Field;
  shape: Shape | null;
  muted?: boolean;
}) {
  const parts = parseType(field.type);
  const page = shape && shape.kind !== "def" ? blockPath(shape.id) : null;
  const copy = field.ref ?? field.type;

  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <Ident
        value={copy}
        className={muted ? "text-muted" : ""}
        title={
          field.ref
            ? `shared type ${field.ref} — click to copy`
            : `${field.type} — click to copy`
        }
      >
        {field.type}
      </Ident>
      {parts.cardinality !== "one" ? (
        <span className="type-mark" title={`${field.type}: ${CARDINALITY[parts.cardinality]} ${parts.base}`}>
          {CARDINALITY[parts.cardinality]}
        </span>
      ) : null}
      {parts.optional ? (
        <span className="type-mark" title="may be absent">
          optional
        </span>
      ) : null}
      {page && shape ? (
        <Link
          to={page}
          className="rounded-control text-muted hover:text-accent"
          title={`open ${KIND_LABEL[shape.kind as "vo" | "entity"]} ${shape.name}`}
          aria-label={`open ${KIND_LABEL[shape.kind as "vo" | "entity"]} ${shape.name}`}
        >
          ↗
        </Link>
      ) : null}
    </span>
  );
}

/** What is under a field, once opened: the shape's header and its own rows. */
export function ShapeBody({
  shape,
  scope,
  path,
  open,
  onToggle,
  seen,
  depth,
  root = false,
}: {
  shape: Shape;
  scope: Scope;
  path: string;
  open: ReadonlySet<string>;
  onToggle: (path: string) => void;
  seen: ReadonlySet<string>;
  depth: number;
  /**
   * The body sits directly in a table cell. A cell grows to fit its content,
   * and a doc line two hundred characters long would widen every column
   * above it; the root takes no width of its own and fills what the row has.
   */
  root?: boolean;
}) {
  const page = shape.kind !== "def" ? blockPath(shape.id) : null;
  const kindLabel = shape.kind === "def" ? "shared type" : KIND_LABEL[shape.kind];
  const where =
    shape.kind === "def"
      ? "the same shape wherever it is named"
      : (shape.aggregate?.id ?? "");
  const inner = scopeOf(shape, scope);

  return (
    <div className={root ? "shape shape-root" : "shape"}>
      <div className="shape-head">
        {shape.kind !== "def" ? (
          <KindIcon kind={shape.kind} size={12} className="shrink-0 text-muted" />
        ) : null}
        {page ? (
          <Link
            to={page}
            className={`mono rounded-control text-accent hover:underline${shape.deprecated ? " line-through" : ""}`}
            title={shape.id}
          >
            {shape.name}
          </Link>
        ) : (
          <Ident value={shape.id} className="text-ink">
            {shape.name}
          </Ident>
        )}
        <span className="meta">
          {kindLabel}
          {where ? <> · {where}</> : null} ·{" "}
          {shape.fields.length} {plural(shape.fields.length, "field")}
        </span>
      </div>
      {shape.doc ? (
        <div className="meta shape-doc" title={shape.doc}>
          {shape.doc}
        </div>
      ) : null}
      {shape.fields.length === 0 ? (
        <div className="meta pl-4">the catalog knows this shape by name only</div>
      ) : (
        <FieldTree
          fields={shape.fields}
          scope={inner}
          prefix={path}
          open={open}
          onToggle={onToggle}
          seen={seen}
          depth={depth}
        />
      )}
    </div>
  );
}

/**
 * Rows for a list of fields, each openable when its type is a shape the
 * catalog has. `seen` holds the shapes already on the way down, so a shape
 * that names itself, however indirectly, is shown once and not opened
 * again; `depth` cuts the honest case of a shape that simply goes on.
 */
export function FieldTree({
  fields,
  scope,
  prefix = "",
  open,
  onToggle,
  seen = new Set(),
  depth = 0,
}: {
  fields: Field[];
  scope: Scope;
  prefix?: string;
  open: ReadonlySet<string>;
  onToggle: (path: string) => void;
  seen?: ReadonlySet<string>;
  depth?: number;
}) {
  return (
    <div className="field-tree" role="list">
      {fields.map((field) => {
        const path = prefix ? `${prefix}.${field.name}` : field.name;
        const shape = resolveShape(catalog, field, scope);
        const openable =
          shape !== null && !seen.has(shape.id) && depth < MAX_DEPTH;
        const shown = openable && open.has(path);
        const nameClass = `mono${field.deprecated ? " line-through" : ""}`;

        return (
          <div key={field.name} role="listitem">
            <div className="field-row" data-open={shown ? "true" : undefined}>
              {openable ? (
                <button
                  type="button"
                  onClick={() => onToggle(path)}
                  aria-expanded={shown}
                  aria-label={`${shown ? "collapse" : "expand"} ${field.name}`}
                  className="field-toggle"
                >
                  {shown ? (
                    <ChevronDown size={11} aria-hidden />
                  ) : (
                    <ChevronRight size={11} aria-hidden />
                  )}
                </button>
              ) : (
                <span className="field-toggle" aria-hidden />
              )}
              <span
                className={nameClass}
                title={field.deprecated ? "deprecated" : undefined}
              >
                {field.name}
              </span>
              <TypeCell field={field} shape={shape} />
              {shape && !openable ? (
                <span
                  className="type-mark"
                  title={
                    seen.has(shape.id)
                      ? `${shape.name} is already open above this row`
                      : "as deep as the tree goes"
                  }
                >
                  ↑ {shape.name}
                </span>
              ) : null}
              {field.doc ? (
                <span className="meta min-w-0 truncate" title={field.doc}>
                  {field.doc}
                </span>
              ) : null}
            </div>
            {shown && shape ? (
              <ShapeBody
                shape={shape}
                scope={scope}
                path={path}
                open={open}
                onToggle={onToggle}
                seen={new Set([...seen, shape.id])}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
