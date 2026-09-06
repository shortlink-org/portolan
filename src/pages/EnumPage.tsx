// One closed set of values, on a page of its own.
//
// Not the block template. A value object has fields, a place it is stored and
// a shared type it may name; an enum has values, the fields that switch on it,
// and - when its values are the lifecycle's states - the moves between them.
// The two pages share their header, their rail and their "what links here",
// and nothing in the middle.

import { Link, useParams } from "react-router";
import { Minus } from "lucide-react";
import { catalog } from "../data";
import { enumsOf } from "../catalog";
import type { Enum, EnumValue } from "../catalog";
import { backlinkCount } from "../lib/backlinks";
import { plural } from "../lib/format";
import { isStatusEnum } from "../lib/shape";
import { KindIcon } from "../components/kind";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { LifecycleDiagram } from "../components/LifecycleDiagram";
import { ENUM_ANCHOR, LINKS_HERE, paths } from "../routes";
import { useBacklinks, WhatLinksHere } from "../components/WhatLinksHere";
import { InLanguage } from "../language/InLanguage";
import { NotFound } from "./NotFound";

/**
 * The values, as columns the table can sort and filter. Declaration order is
 * the source's own, and the table keeps it until the reader asks otherwise:
 * a Go const block and a proto enum both mean something by the order.
 */
const VALUE_COLUMNS: ColumnSpec<EnumValue>[] = [
  {
    id: "name",
    header: "value",
    type: "mono",
    value: (value) => value.name,
    primary: true,
    cell: (value) => (
      <Ident
        value={value.name}
        className={value.deprecated ? "line-through text-muted" : ""}
        title={
          value.deprecated
            ? `${value.name} — deprecated; click to copy`
            : `${value.name} — click to copy`
        }
      />
    ),
  },
  {
    id: "doc",
    header: "doc",
    type: "text",
    value: (value) => value.doc,
    cell: (value) => <span className="meta">{value.doc}</span>,
  },
  {
    id: "state",
    header: "",
    type: "text",
    // Filterable, like "new" on a schema: "which values are on their way
    // out" is a question about the set.
    value: (value) => (value.deprecated ? "deprecated" : undefined),
    cell: (value) =>
      value.deprecated ? (
        <span
          className="mono inline-flex items-center gap-1 text-unresolved"
          title="still on the wire, not to be produced anew"
        >
          <Minus size={10} aria-hidden />
          deprecated
        </span>
      ) : null,
    enableHiding: false,
    size: 96,
  },
];

export function EnumPage() {
  const {
    context: contextId,
    service: serviceSlug,
    aggregate: aggSlug,
    enum: enumSlug,
  } = useParams();

  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const aggregate = service?.aggregates.find((a) => a.slug === aggSlug);
  const list: Enum[] = aggregate ? enumsOf(aggregate) : [];
  const item = list.find((e) => e.slug === enumSlug);

  const links = useBacklinks({ kind: "enum", id: item?.id ?? "" });

  if (!context || !service || !aggregate || !item) {
    return <NotFound kind="Enum" id={enumSlug} />;
  }

  // The status, when the set is the lifecycle's: same states, spelled the
  // way each side spells them. Decided on the values, never on the name.
  const status =
    aggregate.lifecycle !== undefined &&
    isStatusEnum(item, aggregate.lifecycle.states);
  const deprecatedValues = item.values.filter((v) => v.deprecated).length;

  const toc: TocItem[] = [
    { id: ENUM_ANCHOR.values, label: "Values" },
    ...(status ? [{ id: ENUM_ANCHOR.lifecycle, label: "Lifecycle" }] : []),
    { id: ENUM_ANCHOR.siblings, label: "Siblings" },
    { id: LINKS_HERE, label: "What links here" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={
          <>
            enum ·{" "}
            <Link
              to={paths.aggregate(context.id, service.slug, aggregate.slug)}
              className="rounded-control hover:text-ink hover:underline"
            >
              {aggregate.id}
            </Link>
          </>
        }
        name={item.name}
        id={item.id}
        right={
          <span className="flex items-center gap-2">
            {status ? (
              <a
                href={`#${ENUM_ANCHOR.lifecycle}`}
                className="chip status-verified"
                title="its values are the states of the aggregate's lifecycle"
              >
                <span aria-hidden className="dot" />
                the status
              </a>
            ) : null}
            {item.deprecated ? (
              <span className="chip" title="marked deprecated in the source">
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
        <p className="mt-2 max-w-prose text-muted">{item.doc}</p>
        <div className="mono mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          <span>a closed set — a consumer switches on it and handles every value</span>
          <span aria-hidden className="h-4 w-px bg-line-strong" />
          <a
            href={`#${ENUM_ANCHOR.values}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{item.values.length}</span>{" "}
            {plural(item.values.length, "value")}
            {deprecatedValues > 0 ? ` · ${deprecatedValues} deprecated` : ""}
          </a>
          <a href={`#${LINKS_HERE}`} className="rounded-control hover:text-ink">
            <span className="tnum">{backlinkCount(links)}</span>{" "}
            {plural(backlinkCount(links), "reference")}
          </a>
        </div>
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <InLanguage id={item.id} />

          <section id={ENUM_ANCHOR.values}>
            <SectionTitle
              anchor={ENUM_ANCHOR.values}
              right={<span>in the order the source declares them</span>}
            >
              Values
            </SectionTitle>
            {item.values.length === 0 ? (
              <Empty>the catalog knows this set by name only</Empty>
            ) : (
              <div className="max-w-table">
                <DataTable
                  tableId={`enum-values.${item.id}`}
                  caption={`Values of ${item.id}`}
                  columns={VALUE_COLUMNS}
                  rows={item.values}
                  rowId={(value) => value.name}
                  rowActions={(value) => (
                    <RowActions
                      copy={`${item.id}.${value.name}`}
                      label={value.name}
                    />
                  )}
                />
              </div>
            )}
          </section>

          {/* The moves between the values, when the values are states. The
              table lives on the aggregate; it is drawn here again because a
              reader who opened the status wants to know what follows what,
              and a link back to the aggregate would answer with a scroll. */}
          {status ? (
            <section className="mt-section" id={ENUM_ANCHOR.lifecycle}>
              <SectionTitle
                anchor={ENUM_ANCHOR.lifecycle}
                right={
                  <span>
                    the same table the{" "}
                    <Link
                      to={paths.aggregate(context.id, service.slug, aggregate.slug)}
                      className="rounded-control hover:text-ink hover:underline"
                    >
                      aggregate
                    </Link>{" "}
                    draws
                  </span>
                }
              >
                Lifecycle
              </SectionTitle>
              <LifecycleDiagram
                aggregate={aggregate}
                eventPath={(id) => {
                  const event = aggregate.events.find((e) => e.id === id);
                  return event
                    ? paths.event(context.id, service.slug, aggregate.slug, event.slug)
                    : null;
                }}
              />
            </section>
          ) : null}

          <div className="mt-section max-w-prose" id={ENUM_ANCHOR.siblings}>
            <SectionTitle anchor={ENUM_ANCHOR.siblings}>Siblings</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {list
                .filter((e) => e.slug !== item.slug)
                .map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={paths.enum(context.id, service.slug, aggregate.slug, sibling.slug)}
                    className="chip-lg border-line-strong text-muted"
                  >
                    <KindIcon kind="enum" />
                    {sibling.name}
                  </Link>
                ))}
              {list.length <= 1 ? (
                <Empty>the only enum in {aggregate.name}</Empty>
              ) : null}
            </div>
            <div className="mono mt-2 text-muted">enums of {aggregate.id}</div>
          </div>

          {/* Found by name, not by a ref: nothing declares "this field's type
              is that enum", the resolver matched the spelling inside the
              service. Each row says so. */}
          <WhatLinksHere
            target={{ kind: "enum", id: item.id }}
            empty="no field in this service names this set — nothing switches on it that the catalog can see"
          />
        </div>

        <Toc items={toc} label="Sections of this enum" />
      </div>
    </div>
  );
}
