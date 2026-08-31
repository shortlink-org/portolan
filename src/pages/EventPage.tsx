import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { catalog, index } from "../data";
import type { Field } from "../catalog";
import { addedFields, stepsReferencing } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { EVENT_ANCHOR, paths, servicePath } from "../routes";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { StatusChip } from "../components/primitives";
import { NotFound } from "./NotFound";
import { FocusedEventGraphPane } from "../graph/FocusedEventGraph";

/** One level deep only: a ref inside an expanded TypeDef is shown, not expanded. */
function FieldRow({
  field,
  added,
  expanded,
  onToggle,
  owner,
}: {
  field: Field;
  added: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** The event and version the field belongs to, for what "copy id" copies. */
  owner: string;
}) {
  const def = field.ref ? catalog.defs[field.ref] : undefined;
  return (
    <>
      <tr className="align-top">
        <td className="py-1 pr-2">
          {def ? (
            <button
              type="button"
              onClick={onToggle}
              className="mono flex items-center gap-1"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown size={11} aria-hidden className="text-muted" />
              ) : (
                <ChevronRight size={11} aria-hidden className="text-muted" />
              )}
              {field.name}
            </button>
          ) : (
            <span className="mono pl-4">{field.name}</span>
          )}
        </td>
        <td className="py-1 pr-3 whitespace-nowrap">
          <Ident value={field.ref ?? field.type} className="text-muted">
            {field.type}
          </Ident>
        </td>
        <td className="meta py-1 pr-3">{field.doc}</td>
        <td className="py-1 whitespace-nowrap">
          <span className="flex items-center gap-2">
            {added ? (
              <span
                className="mono inline-flex items-center gap-1 text-verified"
                title="added in this version"
              >
                <Plus size={10} aria-hidden />
                new
              </span>
            ) : null}
            <RowActions
              copy={`${owner}.${field.name}`}
              label={`${field.name}`}
            />
          </span>
        </td>
      </tr>
      {expanded && def ? (
        <tr className="bg-surface">
          <td colSpan={4} className="px-4 py-2">
            <Ident block value={field.ref ?? ""} className="mb-1 text-muted" />
            <table className="w-full">
              <tbody>
                {def.fields.map((sub) => (
                  <tr key={sub.name} className="align-top">
                    <td className="mono py-0.5 pr-3 whitespace-nowrap">
                      {sub.name}
                    </td>
                    <td className="mono py-0.5 pr-3 whitespace-nowrap text-muted">
                      {sub.ref ? `${sub.type} →` : sub.type}
                    </td>
                    <td className="py-0.5 text-muted">{sub.doc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}
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
  const appearances = useMemo(
    () => (event ? stepsReferencing(catalog, event.id) : []),
    [event],
  );

  if (!context || !service || !aggregate || !event || !selected) {
    return <NotFound kind="Event" id={eventSlug} />;
  }

  const decisions = index.adrsByEvent.get(event.id) ?? [];

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // The five things there are to know about an event, in the order a reader
  // asks them: what shape is it, how did it get that shape, who listens, where
  // does it happen, and what was decided about it.
  const toc: TocItem[] = [
    { id: EVENT_ANCHOR.schema, label: "Schema" },
    { id: EVENT_ANCHOR.versions, label: "Versions" },
    { id: EVENT_ANCHOR.consumers, label: "Consumers" },
    { id: EVENT_ANCHOR.flows, label: "Flows" },
    { id: EVENT_ANCHOR.decisions, label: "Decisions" },
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
        kind={`event · ${aggregate.id}`}
        name={event.name}
        id={event.id}
        contextId={context.id}
        right={
          <label className="mono flex items-center gap-1.5 text-muted">
            version
            <select
              value={selected.version}
              onChange={(e) => setVersion(e.target.value)}
              className="mono rounded-control border bg-transparent px-2 py-1 border-line text-ink"
            >
              {[...event.versions].reverse().map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                  {v.version === latest ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <p className="mt-2 max-w-prose text-muted">{selected.doc}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Ident value={selected.source} className="text-muted" />
          <span aria-hidden className="h-4 w-px bg-line-strong" />
          <Count
            n={selected.fields.length}
            anchor={EVENT_ANCHOR.schema}
            unit="fields"
          />
          <Count
            n={event.versions.length}
            anchor={EVENT_ANCHOR.versions}
            unit={event.versions.length === 1 ? "version" : "versions"}
          />
          <Count
            n={event.consumers.length}
            anchor={EVENT_ANCHOR.consumers}
            unit={event.consumers.length === 1 ? "consumer" : "consumers"}
          />
          <Count
            n={appearances.length}
            anchor={EVENT_ANCHOR.flows}
            unit={appearances.length === 1 ? "flow step" : "flow steps"}
          />
          <Count
            n={decisions.length}
            anchor={EVENT_ANCHOR.decisions}
            unit={decisions.length === 1 ? "decision" : "decisions"}
          />
        </div>
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          {/* --- Schema ------------------------------------------------- */}
          <section id={EVENT_ANCHOR.schema}>
            <SectionTitle
              right={
                <span className="mono text-muted">
                  {selected.fields.length} fields · {selected.version}
                </span>
              }
            >
              Schema
            </SectionTitle>
            {/* The field list is the widest thing on the page. Its header and
                its first column stay put while the rest scrolls under them. */}
            <div className="max-w-table overflow-x-auto">
              <table className="tbl tbl-sticky">
                <thead>
                  <tr className="label text-left">
                    <th className="pb-2 font-normal">name</th>
                    <th className="pb-2 font-normal">type</th>
                    <th className="pb-2 font-normal">doc</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selected.fields.map((field) => (
                    <FieldRow
                      key={field.name}
                      field={field}
                      added={added.has(field.name)}
                      expanded={expanded.has(field.name)}
                      onToggle={() => toggle(field.name)}
                      owner={`${event.id}@${selected.version}`}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* --- Versions ----------------------------------------------- */}
          <section
            id={EVENT_ANCHOR.versions}
            className="mt-section max-w-table"
          >
            <SectionTitle
              right={<span className="mono text-muted">oldest first</span>}
            >
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
          <section id={EVENT_ANCHOR.consumers} className="mt-section">
            <SectionTitle
              right={
                <span className="mono text-muted">
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

            <div className="flex flex-col gap-3 lg:flex-row">
              <div
                className="flex min-w-0 flex-1 flex-col gap-1.5"
                data-nav-list
              >
                {event.consumers.length === 0 ? (
                  <Empty>nobody is listening — this event falls silent</Empty>
                ) : null}
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
              <div className="min-w-0 flex-1">
                <FocusedEventGraphPane event={event} height={230} />
              </div>
            </div>
          </section>

          {/* --- Flows -------------------------------------------------- */}
          <section id={EVENT_ANCHOR.flows} className="mt-section max-w-table">
            <SectionTitle>Flows</SectionTitle>
            {appearances.length === 0 ? (
              <Empty>no flow has been charted through this event</Empty>
            ) : (
              <div className="flex flex-col gap-1" data-nav-list>
                {appearances.map((ref) => (
                  <div
                    key={`${ref.flow.slug}-${ref.stepId}`}
                    className="row mono gap-2"
                  >
                    <Link
                      to={paths.flowStep(ref.flow.slug, ref.stepId)}
                      data-nav-item
                      className="rounded-control text-accent"
                    >
                      {ref.flow.slug}
                    </Link>
                    <span className="text-muted">
                      step {ref.number} · #{ref.stepId}
                    </span>
                    <RowActions copy={`${ref.flow.slug}/${ref.stepId}`} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* --- Decisions ---------------------------------------------- */}
          <section
            id={EVENT_ANCHOR.decisions}
            className="mt-section max-w-table"
          >
            <SectionTitle>Decisions</SectionTitle>
            {decisions.length === 0 ? (
              <Empty>
                nothing has been decided about this event on the record
              </Empty>
            ) : (
              <div className="flex flex-col gap-1" data-nav-list>
                {decisions.map((adr) => (
                  <div key={adr.id} className="row gap-2">
                    <span className="mono shrink-0 text-muted">{adr.id}</span>
                    <Link
                      to={paths.adr(adr.slug)}
                      data-nav-item
                      className="min-w-0 truncate rounded-control"
                    >
                      {adr.title}
                    </Link>
                    <RowActions copy={adr.id} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <Toc items={toc} label="Sections of this event" />
      </div>
    </div>
  );
}
