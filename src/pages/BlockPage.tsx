// One template for both structural building blocks. An entity and a value
// object differ in whether identity matters, not in what there is to say about
// them, so they share a page and are told apart by the header and the icon.

import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { catalog, index } from "../data";
import { blockFields, rootEntity } from "../catalog";
import type { Block, BlockKind, Field } from "../catalog";
import { openablePaths, resolveShape } from "../lib/shape";
import type { Scope } from "../lib/shape";
import { ShapeBody, TypeCell } from "../components/FieldTree";
import { backlinkCount } from "../lib/backlinks";
import { storedFields } from "../lib/data-model";
import { plural } from "../lib/format";
import { KIND_LABEL, KIND_PLURAL } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import {
  BLOCK_ANCHOR,
  BLOCK_STORED_AS,
  LINKS_HERE,
  blockPath,
  paths,
  tablePath,
} from "../routes";
import { useBacklinks, WhatLinksHere } from "../components/WhatLinksHere";
import { InLanguage } from "../language/InLanguage";
import { NotFound } from "./NotFound";

/**
 * The shape of a value object or an entity. Three columns and usually few
 * rows, so the toolbar stays out of the way until there is enough here to
 * need one. A field whose type is another block of the aggregate - a Line's
 * Money - opens under its row, the way an event's schema does.
 */
function shapeColumns(
  scope: Scope,
  open: ReadonlySet<string>,
  onToggle: (path: string) => void,
): ColumnSpec<Field>[] {
  return [
    {
      id: "name",
      header: "name",
      type: "mono",
      value: (field) => field.name,
      primary: true,
      // Plain, not an <Ident>: the name is a field of this block, not an id
      // anything else refers to. The type beside it is the copyable one.
      cell: (field) => {
        const shape = resolveShape(catalog, field, scope);
        const nameClass = field.deprecated ? "mono line-through" : "mono";
        const title = field.deprecated ? "deprecated" : undefined;
        return shape ? (
          <button
            type="button"
            onClick={() => onToggle(field.name)}
            className="mono flex items-center gap-1 rounded-control"
            aria-expanded={open.has(field.name)}
            title={`${open.has(field.name) ? "collapse" : "expand"} ${shape.name}`}
          >
            {open.has(field.name) ? (
              <ChevronDown size={11} aria-hidden className="text-muted" />
            ) : (
              <ChevronRight size={11} aria-hidden className="text-muted" />
            )}
            <span className={nameClass} title={title}>
              {field.name}
            </span>
          </button>
        ) : (
          <span className={`${nameClass} pl-4`} title={title}>
            {field.name}
          </span>
        );
      },
    },
    {
      id: "type",
      header: "type",
      type: "mono",
      value: (field) => field.ref ?? field.type,
      cell: (field) => (
        <TypeCell field={field} shape={resolveShape(catalog, field, scope)} />
      ),
    },
    {
      id: "doc",
      header: "doc",
      type: "text",
      value: (field) => field.doc,
      cell: (field) => <span className="meta">{field.doc}</span>,
    },
  ];
}

function ShapeTable({
  id,
  fields,
  scope,
  open,
  onToggle,
}: {
  id: string;
  fields: Field[];
  scope: Scope;
  open: ReadonlySet<string>;
  onToggle: (path: string) => void;
}) {
  const columns = useMemo(
    () => shapeColumns(scope, open, onToggle),
    [scope, open, onToggle],
  );
  return (
    <div className="max-w-table">
      <DataTable
        tableId={`block-shape.${id}`}
        caption={`Shape of ${id}`}
        columns={columns}
        rows={fields}
        rowId={(field) => field.name}
        subRow={(field) => {
          if (!open.has(field.name)) return null;
          const shape = resolveShape(catalog, field, scope);
          return shape ? (
            <ShapeBody
              shape={shape}
              scope={scope}
              path={field.name}
              open={open}
              onToggle={onToggle}
              seen={new Set([shape.id])}
              depth={1}
              root
            />
          ) : null;
        }}
      />
    </div>
  );
}

export function BlockPage({ kind }: { kind: BlockKind }) {
  const {
    context: contextId,
    service: serviceSlug,
    aggregate: aggSlug,
    block: blockSlug,
  } = useParams();

  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const aggregate = service?.aggregates.find((a) => a.slug === aggSlug);
  const list: Block[] =
    (kind === "vo" ? aggregate?.valueObjects : aggregate?.entities) ?? [];
  const block = list.find((b) => b.slug === blockSlug);

  // "Used in" was this page's own answer to a question every page has; it is
  // the shared section now, and the block's shape is what it walks.
  const links = useBacklinks({ kind, id: block?.id ?? "" });

  // The rows opened under this block's fields, as dotted paths. The block
  // itself is what its own fields must not open again: an Order whose Line
  // names its Order stops at the name.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (path: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  const scope = useMemo<Scope>(
    () => ({ aggregate: aggregate ?? null, service: service ?? null }),
    [aggregate, service],
  );
  const fields = useMemo(
    () => (block ? blockFields(catalog, block) : []),
    [block],
  );
  const openable = useMemo(
    () =>
      block
        ? openablePaths(catalog, fields, scope, "", new Set([block.id]))
        : [],
    [block, fields, scope],
  );

  if (!context || !service || !aggregate || !block) {
    return <NotFound kind={KIND_LABEL[kind]} id={blockSlug} />;
  }

  const stored = storedFields(catalog, index, block.id);
  const toc: TocItem[] = [
    { id: BLOCK_ANCHOR.shape, label: "Shape" },
    ...(stored.length > 0
      ? [{ id: BLOCK_STORED_AS, label: "Stored as" }]
      : []),
    { id: BLOCK_ANCHOR.siblings, label: "Siblings" },
    { id: LINKS_HERE, label: "What links here" },
  ];

  const isRoot =
    kind === "entity" && rootEntity(aggregate)?.slug === block.slug;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={
          <>
            <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
              <KindIcon kind={kind} size={13} />
              {KIND_LABEL[kind]}
            </span>
            <span aria-hidden className="mx-1.5 text-faint">
              ·
            </span>
            <Link
              to={paths.aggregate(context.id, service.slug, aggregate.slug)}
              className="rounded-control hover:text-ink hover:underline"
            >
              {aggregate.id}
            </Link>
          </>
        }
        name={block.name}
        id={block.id}
        right={
          <span className="flex -translate-y-0.5 items-center gap-2">
            {isRoot ? (
              <span className="chip-lg status-verified" title="aggregate root">
                <span aria-hidden className="dot" />
                root
              </span>
            ) : null}
            {block.deprecated ? (
              <span
                className="chip-lg"
                title="marked @deprecated in the source"
              >
                deprecated
              </span>
            ) : null}
            <Link
              to={paths.aggregate(context.id, service.slug, aggregate.slug)}
              className="chip-lg border-line-strong text-muted"
            >
              <KindIcon kind="aggregate" />
              {aggregate.name}
            </Link>
          </span>
        }
      >
        {block.doc ? (
          <p className="mt-2 max-w-prose text-muted">{block.doc}</p>
        ) : null}
        {block.ref ? (
          <dl className="mt-2.5 grid grid-cols-1 items-start gap-x-8 gap-y-2 sm:grid-cols-[minmax(0,max-content)_max-content] sm:justify-start">
            <div className="min-w-0">
              <dt className="label mb-1">Type scope</dt>
              <dd className="mono flex min-w-0 flex-wrap items-center gap-1.5 text-muted">
                <span>shared</span>
                <Ident value={block.ref} className="text-ink" />
              </dd>
            </div>
            <div>
              <dt className="label mb-1">References</dt>
              <dd>
                <a
                  href={`#${LINKS_HERE}`}
                  className="mono rounded-control text-ink hover:text-accent hover:underline"
                >
                  <span className="tnum">{backlinkCount(links)}</span>{" "}
                  {plural(backlinkCount(links), "reference")}
                </a>
              </dd>
            </div>
          </dl>
        ) : null}
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <InLanguage id={block.id} />

          <section id={BLOCK_ANCHOR.shape}>
            <SectionTitle
              anchor={BLOCK_ANCHOR.shape}
              right={
                <span className="flex items-center gap-x-3">
                  {openable.length > 0 ? (
                    <span className="mono flex items-center gap-x-2">
                      {openable.some((path) => !open.has(path)) ? (
                        <button
                          type="button"
                          onClick={() => setOpen(new Set(openable))}
                          className="rounded-control text-muted hover:text-ink"
                          title={`open every nested shape (${openable.length})`}
                        >
                          expand all
                        </button>
                      ) : null}
                      {openable.some((path) => open.has(path)) ? (
                        <button
                          type="button"
                          onClick={() => setOpen(new Set())}
                          className="rounded-control text-muted hover:text-ink"
                        >
                          collapse all
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  <span>
                    {fields.length} {plural(fields.length, "field")}
                  </span>
                </span>
              }
            >
              Shape
            </SectionTitle>
            {fields.length === 0 ? (
              <Empty>the catalog knows this block by name only</Empty>
            ) : (
              <ShapeTable
                id={block.id}
                fields={fields}
                scope={scope}
                open={open}
                onToggle={toggle}
              />
            )}
          </section>

          {/* The columns that carry these fields. Only drawn when there are
              any: a block nothing persists is not missing a section, it is a
              shape that lives inside another row. */}
          {stored.length > 0 ? (
            <section className="mt-section max-w-table" id={BLOCK_STORED_AS}>
              <SectionTitle
                anchor={BLOCK_STORED_AS}
                right={
                  <span>
                    db type beside domain type
                  </span>
                }
              >
                Stored as
              </SectionTitle>
              <table className="w-full max-w-table">
                <thead>
                  <tr className="label border-b border-line text-left">
                    <th className="py-1 pr-3 font-normal">column</th>
                    <th className="py-1 pr-3 font-normal">db type</th>
                    <th className="py-1 pr-3 font-normal">field</th>
                    <th className="py-1 font-normal">domain type</th>
                  </tr>
                </thead>
                <tbody>
                  {stored.map(({ owner, path, field, mismatch }) => {
                    const to = tablePath(owner.table.id);
                    const id = `${owner.table.id}.${owner.column.name}`;
                    return (
                      <tr key={id} className="border-b border-line align-top">
                        <td className="mono py-1.5 pr-3 whitespace-nowrap">
                          {to ? (
                            <Link
                              to={to}
                              className="rounded-control hover:underline"
                              title={id}
                            >
                              {owner.table.name}.{owner.column.name}
                            </Link>
                          ) : (
                            <span title={id}>
                              {owner.table.name}.{owner.column.name}
                            </span>
                          )}
                        </td>
                        <td className="mono py-1.5 pr-3 whitespace-nowrap text-muted">
                          {owner.column.type}
                          {owner.column.nullable ? "?" : ""}
                        </td>
                        <td className="mono py-1.5 pr-3 whitespace-nowrap">
                          {path}
                        </td>
                        <td className="mono py-1.5 whitespace-nowrap">
                          {field ? (
                            <span className="flex items-center gap-1.5">
                              {/* An amber dot, not a red one: neither side is
                                  wrong on its own, and which one moved is the
                                  reader's call. */}
                              {mismatch ? (
                                <span
                                  aria-hidden
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{
                                    background: "var(--status-declared)",
                                  }}
                                  title={`${owner.column.type} in the column, ${field.type} in the model`}
                                />
                              ) : null}
                              <span
                                className={
                                  mismatch ? "text-declared" : "text-muted"
                                }
                              >
                                {field.type}
                              </span>
                            </span>
                          ) : (
                            <span
                              className="text-unresolved"
                              title={`${block.name} declares no field "${path}"`}
                            >
                              no such field
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ) : null}

          <div className="mt-section max-w-prose" id={BLOCK_ANCHOR.siblings}>
            <SectionTitle anchor={BLOCK_ANCHOR.siblings}>Siblings</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {list
                .filter((b) => b.slug !== block.slug)
                .map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={
                      (blockPath(sibling.id) as string) ??
                      paths.aggregate(context.id, service.slug, aggregate.slug)
                    }
                    className="chip-lg border-line-strong text-muted"
                  >
                    <KindIcon kind={kind} />
                    {sibling.name}
                  </Link>
                ))}
              {list.length <= 1 ? (
                <Empty>
                  the only {KIND_LABEL[kind]} in {aggregate.name}
                </Empty>
              ) : null}
            </div>
            <div className="mono mt-2 text-muted">
              {KIND_PLURAL[kind]} of {aggregate.id}
            </div>
          </div>

          {/* Two blocks are the same type only if they name the same def, so
              this walks the shared type rather than the name: a Money here and
              a Money there are one thing or they are two, and the catalog has
              already said which. */}
          <WhatLinksHere
            target={{ kind, id: block.id }}
            empty={
              block.ref
                ? `nothing else names ${block.ref}`
                : "an inline shape is used only here — give it a shared type to track it across the catalog"
            }
          />
        </div>

        <Toc items={toc} label={`Sections of this ${KIND_LABEL[kind]}`} />
      </div>
    </div>
  );
}
