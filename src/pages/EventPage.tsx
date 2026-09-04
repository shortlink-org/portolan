import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { catalog, index } from "../data";
import { plural } from "../lib/format";
import type { Field } from "../catalog";
import { addedFields } from "../lib/derive";
import { backlinkCount, stepsInto } from "../lib/backlinks";
import { outboxOfService } from "../lib/data-model";
import { ctxStyle } from "../lib/context-color";
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
import { ShapeRows } from "../components/ShapeRows";
import { RowActions } from "../components/RowActions";
import { DataTable } from "../table/DataTable";
import type { ColumnSpec } from "../table/types";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { StatusChip } from "../components/primitives";
import { useBacklinks, WhatLinksHere } from "../components/WhatLinksHere";
import { NotFound } from "./NotFound";
import { FocusedEventGraphPane } from "../graph/FocusedEventGraph";
import { eventChain } from "../flow/chain";
import { ChainList } from "../flow/ChainList";

/**
 * The schema, as columns the table knows how to sort and filter. Field order
 * in a proto is meaningful, so nothing is sorted until the reader asks; what
 * the table adds is the ability to ask - "which fields are strings", "which
 * one was the timestamp" - over a schema too long to scan.
 */
function schemaColumns(
  added: Set<string>,
  expanded: Set<string>,
  onToggle: (name: string) => void,
): ColumnSpec<Field>[] {
  const columns: ColumnSpec<Field>[] = [
    {
      id: "name",
      header: "name",
      type: "mono",
      value: (field) => field.name,
      primary: true,
      cell: (field) =>
        // Only a field whose type is a shared type has anything to open.
        field.ref && catalog.defs[field.ref] ? (
          <button
            type="button"
            onClick={() => onToggle(field.name)}
            className="mono flex items-center gap-1"
            aria-expanded={expanded.has(field.name)}
          >
            {expanded.has(field.name) ? (
              <ChevronDown size={11} aria-hidden className="text-muted" />
            ) : (
              <ChevronRight size={11} aria-hidden className="text-muted" />
            )}
            {field.name}
          </button>
        ) : (
          <span className="mono pl-4">{field.name}</span>
        ),
    },
    {
      id: "type",
      header: "type",
      type: "mono",
      value: (field) => field.type,
      cell: (field) => (
        <Ident value={field.ref ?? field.type} className="text-muted">
          {field.type}
        </Ident>
      ),
    },
    {
      id: "doc",
      header: "doc",
      type: "text",
      value: (field) => field.doc,
      cell: (field) => <span className="meta">{field.doc}</span>,
    },
    {
      id: "new",
      header: "",
      type: "text",
      // Sortable and filterable like any other column: "show me what this
      // version added" is a question about the schema, not a decoration.
      value: (field) => (added.has(field.name) ? "new" : undefined),
      cell: (field) =>
        added.has(field.name) ? (
          <span
            className="mono inline-flex items-center gap-1 text-verified"
            title="added in this version"
          >
            <Plus size={10} aria-hidden />
            new
          </span>
        ) : null,
      enableHiding: false,
      size: 60,
    },
  ];
  return columns;
}

/** One level deep only: a ref inside an expanded TypeDef is shown, not expanded. */
function TypeDefBody({ field }: { field: Field }) {
  const def = field.ref ? catalog.defs[field.ref] : undefined;
  if (!def) return null;
  return (
    <>
      <Ident block value={field.ref ?? ""} className="mb-1 text-muted" />
      <ShapeRows fields={def.fields} />
    </>
  );
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () =>
      event?.versions.find((v) => v.version === version) ?? event?.versions[0],
    [event, version],
  );
  const added = useMemo(
    () =>
      event && selected
        ? addedFields(event, selected.version)
        : new Set<string>(),
    [event, selected],
  );
  // Flows, decisions and consumers all point AT this event, so they are one
  // question with one answer; the section at the bottom is where it is given.
  const links = useBacklinks({ kind: "event", id: event?.id ?? "" });

  const toggle = useCallback(
    (name: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      }),
    [],
  );
  // Above the not-found return, with every other hook: the columns are built
  // once per render of a schema, and a hook cannot sit behind a branch.
  const schema = useMemo(
    () => schemaColumns(added, expanded, toggle),
    [added, expanded, toggle],
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
          {/* --- Schema ------------------------------------------------- */}
          <section id={EVENT_ANCHOR.schema}>
            <SectionTitle
              anchor={EVENT_ANCHOR.schema}
              right={
                <span>
                  {selected.fields.length}{" "}
                  {plural(selected.fields.length, "field")} ·{" "}
                  <span className="mono">{selected.version}</span>
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
                rows={selected.fields}
                rowId={(field) => field.name}
                subRow={(field) =>
                  expanded.has(field.name) ? (
                    <TypeDefBody field={field} />
                  ) : null
                }
                rowActions={(field) => (
                  <RowActions
                    copy={`${event.id}@${selected.version}.${field.name}`}
                    label={field.name}
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
