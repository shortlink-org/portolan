import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { catalog, index } from "../data";
import { plural } from "../lib/format";
import type { Field } from "../catalog";
import { backlinkCount, stepsInto } from "../lib/backlinks";
import { outboxOfService } from "../lib/data-model";
import { ctxStyle } from "../lib/context-color";
import {
  eventScope,
  openablePaths,
  resolveShape,
  schemaChanges,
} from "../lib/shape";
import type { Change, Scope } from "../lib/shape";
import {
  EVENT_ANCHOR,
  LINKS_HERE,
  paths,
  servicePath,
  tablePath,
} from "../routes";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Ident } from "../components/Ident";
import { ShapeBody, TypeCell } from "../components/FieldTree";
import { RowActions } from "../components/RowActions";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { StatusChip } from "../components/primitives";
import { useBacklinks, WhatLinksHere } from "../components/WhatLinksHere";
import { InLanguage } from "../language/InLanguage";
import { NotFound } from "./NotFound";
import { FocusedEventGraphPane } from "../graph/FocusedEventGraph";
import { eventChain } from "../flow/chain";
import { ChainList } from "../flow/ChainList";

/**
 * One row of the schema table: a field of the version shown, or a field the
 * version dropped. A dropped field is still a row because "what did v3 take
 * away" is asked at the same table as "what did it add", and a table of the
 * fields that survived cannot answer it.
 */
interface SchemaRow extends Field {
  change?: Change;
  /** The type the previous version gave the field, when this one changed it. */
  from?: string;
}

/** What the change column says, and in what colour. */
const CHANGE: Record<Change, { label: string; className: string; title: string }> = {
  new: {
    label: "new",
    className: "text-verified",
    title: "added in this version",
  },
  changed: {
    label: "changed",
    className: "text-declared",
    title: "type changed in this version",
  },
  removed: {
    label: "removed",
    className: "text-unresolved",
    title: "dropped by this version — shown as the previous version had it",
  },
};

function ChangeMark({ row }: { row: SchemaRow }) {
  if (!row.change) return null;
  const mark = CHANGE[row.change];
  const title =
    row.change === "changed" && row.from
      ? `was ${row.from} in the previous version`
      : mark.title;
  return (
    <span
      className={`mono inline-flex items-center gap-1 ${mark.className}`}
      title={title}
    >
      {row.change === "new" ? <Plus size={10} aria-hidden /> : null}
      {row.change === "removed" ? <Minus size={10} aria-hidden /> : null}
      {mark.label}
    </span>
  );
}

/**
 * The schema, as columns the table knows how to sort and filter. Field order
 * in a proto is meaningful, so nothing is sorted until the reader asks; what
 * the table adds is the ability to ask - "which fields are strings", "which
 * one was the timestamp" - over a schema too long to scan.
 *
 * A field whose type the catalog has a shape for - a shared def by ref, or a
 * value object or entity of the aggregate by name - opens under its row, and
 * keeps opening as far as the shapes go.
 */
function schemaColumns(
  scope: Scope,
  open: ReadonlySet<string>,
  onToggle: (path: string) => void,
): ColumnSpec<SchemaRow>[] {
  const columns: ColumnSpec<SchemaRow>[] = [
    {
      id: "name",
      header: "name",
      type: "mono",
      value: (row) => row.name,
      primary: true,
      cell: (row) => {
        const struck = row.deprecated || row.change === "removed";
        const nameClass = `mono${struck ? " line-through" : ""}${row.change === "removed" ? " text-muted" : ""}`;
        const title = row.change === "removed"
          ? "removed in this version"
          : row.deprecated
            ? "deprecated"
            : undefined;
        // Only a field the catalog has a shape for has anything to open.
        const shape =
          row.change === "removed" ? null : resolveShape(catalog, row, scope);
        return shape ? (
          <button
            type="button"
            onClick={() => onToggle(row.name)}
            className="mono flex items-center gap-1 rounded-control"
            aria-expanded={open.has(row.name)}
            title={`${open.has(row.name) ? "collapse" : "expand"} ${shape.name}`}
          >
            {open.has(row.name) ? (
              <ChevronDown size={11} aria-hidden className="text-muted" />
            ) : (
              <ChevronRight size={11} aria-hidden className="text-muted" />
            )}
            <span className={nameClass} title={title}>
              {row.name}
            </span>
          </button>
        ) : (
          <span className={`${nameClass} pl-4`} title={title}>
            {row.name}
          </span>
        );
      },
    },
    {
      id: "type",
      header: "type",
      type: "mono",
      value: (row) => row.type,
      cell: (row) => (
        <TypeCell
          field={row}
          shape={
            row.change === "removed" ? null : resolveShape(catalog, row, scope)
          }
        />
      ),
    },
    {
      id: "doc",
      header: "doc",
      type: "text",
      value: (row) => row.doc,
      cell: (row) => <span className="meta">{row.doc}</span>,
    },
    {
      id: "change",
      header: "change",
      type: "text",
      // Sortable and filterable like any other column: "show me what this
      // version did" is a question about the schema, not a decoration.
      value: (row) => row.change,
      cell: (row) => <ChangeMark row={row} />,
      facet: true,
      enableHiding: false,
      size: 88,
    },
  ];
  return columns;
}

/** " · +2 · ~1 · −1", or nothing when the version changed nothing. */
function changeSummary(rows: SchemaRow[]): string {
  const n = (change: Change) =>
    rows.filter((row) => row.change === change).length;
  const parts = [
    [n("new"), "+"],
    [n("changed"), "~"],
    [n("removed"), "−"],
  ] as const;
  return parts
    .filter(([count]) => count > 0)
    .map(([count, sign]) => ` · ${sign}${count}`)
    .join("");
}

export function EventPage() {
  const {
    context: contextId,
    service: serviceSlug,
    aggregate: aggSlug,
    event: eventSlug,
  } = useParams();
  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const aggregate = service?.aggregates.find((a) => a.slug === aggSlug);
  const event = aggregate?.events.find((e) => e.slug === eventSlug);

  const latest = event?.versions[event.versions.length - 1]?.version ?? "";
  const [version, setVersion] = useState(latest);
  // Dotted paths of the rows opened, at every depth: "items", then
  // "items.unitPrice". Kept across versions on purpose - a reader comparing
  // v1 to v2 wants the same fields open in both.
  const [open, setOpen] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () =>
      event?.versions.find((v) => v.version === version) ?? event?.versions[0],
    [event, version],
  );
  // The version's rows, with what it did to each against the one before.
  const rows = useMemo<SchemaRow[]>(() => {
    if (!event || !selected) return [];
    const { byField, removed } = schemaChanges(event, selected.version);
    return [
      ...selected.fields.map((field) => ({ ...field, ...byField.get(field.name) })),
      ...removed.map((field) => ({ ...field, change: "removed" as const })),
    ];
  }, [event, selected]);
  const scope = useMemo<Scope>(
    () =>
      event ? eventScope(index, event) : { aggregate: null, service: null },
    [event],
  );
  // Everything the tree could open under this version, for "expand all".
  const openable = useMemo(
    () => (selected ? openablePaths(catalog, selected.fields, scope) : []),
    [selected, scope],
  );
  // Flows, decisions and consumers all point AT this event, so they are one
  // question with one answer; the section at the bottom is where it is given.
  const links = useBacklinks({ kind: "event", id: event?.id ?? "" });

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
  // Above the not-found return, with every other hook: the columns are built
  // once per render of a schema, and a hook cannot sit behind a branch.
  const schema = useMemo(
    () => schemaColumns(scope, open, toggle),
    [scope, open, toggle],
  );
  // What follows this event, as far as the flows say; and, for a consumer no
  // source declared, the number of the step it was read from.
  const eventId = event?.id ?? "";
  const chain = useMemo(() => eventChain(catalog, eventId), [eventId]);
  const stepNumber = useMemo(
    () =>
      new Map(
        stepsInto(catalog, new Set([eventId])).map((s) => [
          `${s.flow.slug}|${s.stepId}`,
          s.number,
        ]),
      ),
    [eventId],
  );

  if (!context || !service || !aggregate || !event || !selected) {
    return <NotFound kind="Event" id={eventSlug} />;
  }

  const outbox = outboxOfService(index, service.id);
  const outboxTo = outbox ? tablePath(outbox.table.id) : null;

  // The four things there are to know about an event, in the order a reader
  // asks them: what shape is it, how did it get that shape, who listens, and
  // what else in the estate names it.
  const toc: TocItem[] = [
    { id: EVENT_ANCHOR.schema, label: "Schema" },
    { id: EVENT_ANCHOR.versions, label: "Versions" },
    { id: EVENT_ANCHOR.consumers, label: "Consumers" },
    { id: EVENT_ANCHOR.then, label: "Then what" },
    { id: LINKS_HERE, label: "What links here" },
  ];

  /** Every count on this page opens the section that holds what it counted. */
  const Count = ({
    n,
    anchor,
    unit,
  }: {
    n: number;
    anchor: string;
    unit: string;
  }) => (
    <a
      href={`#${anchor}`}
      className="mono rounded-control text-muted hover:text-ink"
      title={`jump to ${unit}`}
    >
      <span className="tnum">{n}</span> {unit}
    </a>
  );

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={
          <>
            event ·{" "}
            <Link
              to={paths.aggregate(context.id, service.slug, aggregate.slug)}
              className="rounded-control hover:text-ink hover:underline"
            >
              {aggregate.id}
            </Link>
          </>
        }
        name={event.name}
        id={event.id}
        contextId={context.id}
        pin={{ kind: "event", id: event.id }}
        right={
          <span className="mono flex items-center gap-1.5 text-muted">
            {selected.deprecated ? (
              <span className="chip" title="this version is marked @deprecated in the source">
                deprecated
              </span>
            ) : null}
            version
            <Select
              value={selected.version}
              onChange={setVersion}
              label="Schema version"
              title="Which version of this event's schema the page shows"
              menuWidth={260}
              options={[...event.versions].reverse().map((v) => ({
                value: v.version,
                label:
                  v.version === latest ? `${v.version} (latest)` : v.version,
                note: v.doc,
              }))}
            />
          </span>
        }
      >
        <p className="mt-2 max-w-prose text-muted">{selected.doc}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Ident value={selected.source} className="text-muted" />
          <span aria-hidden className="h-4 w-px bg-line-strong" />
          <Count
            n={selected.fields.length}
            anchor={EVENT_ANCHOR.schema}
            unit={plural(selected.fields.length, "field")}
          />
          <Count
            n={event.versions.length}
            anchor={EVENT_ANCHOR.versions}
            unit={plural(event.versions.length, "version")}
          />
          <Count
            n={event.consumers.length}
            anchor={EVENT_ANCHOR.consumers}
            unit={plural(event.consumers.length, "consumer")}
          />
          <Count
            n={backlinkCount(links)}
            anchor={LINKS_HERE}
            unit={plural(backlinkCount(links), "link here", "links here")}
          />
        </div>
        {/* What the bus sees: the name on the message and the channel it goes
            on. The one line to take to a subscription or a trace search. */}
        {event.wire ? (
          <div className="meta mt-2">
            On the wire as{" "}
            <span className="mono text-ink">{event.wire.name}</span>
            {event.wire.channel ? (
              <>
                , on <span className="mono">{event.wire.channel}</span>
              </>
            ) : null}
          </div>
        ) : null}
        {/* How this event actually leaves the service. It is a fact about the
            publisher, not about the schema, but it belongs here: a consumer
            reading this page wants to know whether the event is committed with
            the state change or published on a best effort after it. */}
        {outbox ? (
          <div className="meta mt-2">
            Delivery: transactional outbox via{" "}
            {outboxTo ? (
              <Link
                to={outboxTo}
                className="mono rounded-control text-accent hover:underline"
              >
                {outbox.table.name}
              </Link>
            ) : (
              <span className="mono text-ink">{outbox.table.name}</span>
            )}{" "}
            in <span className="mono">{outbox.store.slug}</span>
          </div>
        ) : null}
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <InLanguage id={event.id} />

          {/* --- Schema ------------------------------------------------- */}
          <section id={EVENT_ANCHOR.schema}>
            <SectionTitle
              anchor={EVENT_ANCHOR.schema}
              right={
                <span className="flex items-center gap-x-3">
                  {/* Both offered while anything is open: a reader who
                      opened three of eight shapes wants "the rest" as much
                      as "none", and either word alone guesses which. */}
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
                    {selected.fields.length}{" "}
                    {plural(selected.fields.length, "field")}
                    {changeSummary(rows)} ·{" "}
                    <span className="mono">{selected.version}</span>
                  </span>
                </span>
              }
            >
              Schema
            </SectionTitle>
            {/* The field list is the widest thing on the page. Its header and
                its first column stay put while the rest scrolls under them. */}
            <div className="max-w-table">
              <DataTable
                /* Per version: the schema a reader widened is the schema they
                   were reading, and v1 and v3 are not the same schema. */
                tableId={`event-schema.${event.id}`}
                caption={`Schema of ${event.id} ${selected.version}`}
                columns={schema}
                rows={rows}
                rowId={(row) => row.name}
                subRow={(row) => {
                  if (row.change === "removed" || !open.has(row.name)) return null;
                  const shape = resolveShape(catalog, row, scope);
                  return shape ? (
                    <ShapeBody
                      shape={shape}
                      scope={scope}
                      path={row.name}
                      open={open}
                      onToggle={toggle}
                      seen={new Set([shape.id])}
                      depth={1}
                      root
                    />
                  ) : null;
                }}
                rowActions={(row) => (
                  <RowActions
                    copy={`${event.id}@${selected.version}.${row.name}`}
                    label={row.name}
                  />
                )}
              />
            </div>
          </section>

          {/* --- Versions ----------------------------------------------- */}
          <section
            id={EVENT_ANCHOR.versions}
            className="mt-section max-w-table"
          >
            <SectionTitle anchor={EVENT_ANCHOR.versions} right="oldest first">
              Versions
            </SectionTitle>
            {/* The row is a div holding a button, not a button holding
                buttons: the actions are interactive too, and interactive
                content does not nest. */}
            <div className="flex flex-col gap-1" data-nav-list>
              {event.versions.map((v) => {
                const on = v.version === selected.version;
                return (
                  <div
                    key={v.version}
                    className="row items-start gap-3"
                    style={{
                      borderColor: on ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    <button
                      type="button"
                      data-nav-item
                      onClick={() => setVersion(v.version)}
                      aria-pressed={on}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-control text-left"
                    >
                      <span
                        className="mono shrink-0 rounded-[4px] border px-1"
                        style={{
                          borderColor: on ? "var(--accent)" : "var(--border)",
                          color: on ? "var(--accent)" : "var(--fg-muted)",
                        }}
                      >
                        {v.version}
                      </span>
                      {v.version === latest ? (
                        <span className="mono shrink-0 text-muted">latest</span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate" title={v.doc}>
                        {v.doc}
                      </span>
                    </button>
                    <span className="mono shrink-0 text-muted">
                      {v.fields.length}f
                    </span>
                    <RowActions
                      copy={`${event.id}@${v.version}`}
                      label={`${event.name} ${v.version}`}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* --- Consumers ---------------------------------------------- */}
          <section
            id={EVENT_ANCHOR.consumers}
            className="mt-section max-w-table"
          >
            <SectionTitle
              anchor={EVENT_ANCHOR.consumers}
              right={
                <span>
                  published by{" "}
                  <Link
                    to={paths.service(context.id, service.slug)}
                    className="chip ctx"
                    style={ctxStyle(context.id)}
                  >
                    <span aria-hidden className="dot" />
                    {service.id}
                  </Link>
                </span>
              }
            >
              Consumers
            </SectionTitle>

            {/* With nobody listening there is no picture to draw: publisher
                and event are already the two lines above, and half a section
                of empty canvas beside one sentence says only that the layout
                expected something else. */}
            {event.consumers.length === 0 ? (
              <Empty>nobody is listening — this event falls silent</Empty>
            ) : (
              /* The list and the picture stack rather than sit side by side.
                 The picture runs left to right - publisher, event, consumers -
                 and half a column is not enough width for three layers of it:
                 it fits by zooming out, and a node zoomed out is a grey mark
                 where a name was. */
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5" data-nav-list>
                  {event.consumers.map((consumer) => {
                    const to = servicePath(consumer.service);
                    return (
                      <div
                        key={consumer.service}
                        className="row items-start gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          {to ? (
                            <Link
                              to={to}
                              data-nav-item
                              className="mono rounded-control text-accent"
                            >
                              {consumer.service}
                            </Link>
                          ) : (
                            <span className="mono text-unresolved">
                              {consumer.service}
                            </span>
                          )}
                          {consumer.note ? (
                            <p className="mt-0.5 text-muted">{consumer.note}</p>
                          ) : null}
                          {/* No source declared this consumer: a flow showed
                              the service hearing the event, and this says
                              which step, so the claim can be checked. */}
                          {consumer.via ? (
                            <Link
                              to={paths.flowStep(consumer.via.flow, consumer.via.step)}
                              className="chip mt-1 text-muted hover:text-ink"
                              title="derived from a flow step, not declared by any source"
                            >
                              from flow {consumer.via.flow}
                              {stepNumber.has(`${consumer.via.flow}|${consumer.via.step}`)
                                ? ` · step ${stepNumber.get(`${consumer.via.flow}|${consumer.via.step}`)}`
                                : ""}
                            </Link>
                          ) : null}
                        </div>
                        <StatusChip status={consumer.status} />
                        <RowActions
                          copy={consumer.service}
                          {...(to ? { reveal: consumer.service } : {})}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* producer -> event -> consumers, the same fact as a picture */}
                <FocusedEventGraphPane event={event} />
              </div>
            )}
          </section>

          {/* --- Then what -------------------------------------------- */}
          {/* The consumers say who hears it; this says what they do next,
              read off the flow step where each is shown hearing it. Nothing
              here is a new fact, and every row links to the step it came
              from. */}
          <section id={EVENT_ANCHOR.then} className="mt-section max-w-table">
            <SectionTitle anchor={EVENT_ANCHOR.then}>Then what</SectionTitle>
            {chain.nodes.length === 0 ? (
              <Empty>nothing follows an event nobody hears</Empty>
            ) : (
              <ChainList chain={chain} />
            )}
          </section>

          {/* --- What links here -------------------------------------- */}
          {/* Consumers keep their own section: a row can carry the name and
              the status, but not the note or the picture beside them. */}
          <WhatLinksHere
            target={{ kind: "event", id: event.id }}
            elsewhere={{
              service: {
                href: `#${EVENT_ANCHOR.consumers}`,
                label: "Consumers",
              },
            }}
            empty="nothing in the catalog names this event — no flow, no decision, nobody listening"
          />
        </div>

        <Toc items={toc} label="Sections of this event" />
      </div>
    </div>
  );
}
