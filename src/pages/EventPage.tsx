import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { catalog } from "../data";
import type { Field } from "../catalog";
import { addedFields, stepsReferencing } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { paths, servicePath } from "../routes";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { StatusChip } from "../components/primitives";
import { NotFound } from "./NotFound";
import { FocusedEventGraphPane } from "../graph/FocusedEventGraph";

/** One level deep only: a ref inside an expanded TypeDef is shown, not expanded. */
function FieldRow({
  field,
  added,
  expanded,
  onToggle,
}: {
  field: Field;
  added: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const def = field.ref ? catalog.defs[field.ref] : undefined;
  return (
    <>
      <tr className="border-t align-top border-line">
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
        <td className="mono py-1 pr-3 whitespace-nowrap text-muted">
          {field.type}
        </td>
        <td className="py-1 pr-3 text-muted">{field.doc}</td>
        <td className="py-1 whitespace-nowrap">
          {added ? (
            <span
              className="mono inline-flex items-center gap-1 text-verified"
              title="added in this version"
            >
              <Plus size={10} aria-hidden />
              new
            </span>
          ) : null}
        </td>
      </tr>
      {expanded && def ? (
        <tr className="bg-surface">
          <td colSpan={4} className="px-4 py-2">
            <div className="mono mb-1 text-muted">{field.ref}</div>
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

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind={`event · ${aggregate.id}`}
        name={event.name}
        id={event.id}
        right={
          <label className="mono flex items-center gap-1.5 text-muted">
            version
            <select
              value={selected.version}
              onChange={(e) => setVersion(e.target.value)}
              className="mono border bg-transparent px-1.5 py-0.5 border-line text-ink"
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
        <p className="mt-1.5 max-w-[900px] text-muted">{selected.doc}</p>
        <div className="mono mt-1.5 text-muted">{selected.source}</div>
      </PageHeader>

      <div className="p-4">
        <SectionTitle
          right={
            <span className="mono text-muted">
              {selected.fields.length} fields · {selected.version}
            </span>
          }
        >
          Fields
        </SectionTitle>
        <table className="w-full">
          <thead>
            <tr className="label">
              <th className="pb-1 text-left font-normal">name</th>
              <th className="pb-1 text-left font-normal">type</th>
              <th className="pb-1 text-left font-normal">doc</th>
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
              />
            ))}
          </tbody>
        </table>

        <div className="mt-6 grid gap-6 grid-cols-2">
          <div>
            <SectionTitle>Published by</SectionTitle>
            <Link
              to={paths.service(context.id, service.slug)}
              className="chip-lg ctx"
              style={ctxStyle(context.id)}
            >
              {service.id}
            </Link>

            <div className="mt-6">
              <SectionTitle>Consumed by</SectionTitle>
              <div className="flex flex-col gap-1.5">
                {event.consumers.length === 0 ? (
                  <Empty>nothing consumes this event</Empty>
                ) : null}
                {event.consumers.map((consumer) => {
                  const to = servicePath(consumer.service);
                  return (
                    <div
                      key={consumer.service}
                      className="flex items-start gap-2 border px-2 py-1.5 border-line"
                    >
                      <div className="min-w-0 flex-1">
                        {to ? (
                          <Link to={to} className="mono text-accent">
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
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <SectionTitle>Shape</SectionTitle>
            <FocusedEventGraphPane event={event} height={230} />

            <div className="mt-6">
              <SectionTitle>Appears in flows</SectionTitle>
              {appearances.length === 0 ? (
                <Empty>no flow references this event</Empty>
              ) : (
                <div className="flex flex-col gap-1">
                  {appearances.map((ref) => (
                    <Link
                      key={`${ref.flow.slug}-${ref.stepId}`}
                      to={paths.flowStep(ref.flow.slug, ref.stepId)}
                      className="row mono gap-2 px-2 py-1"
                    >
                      <span className="text-accent">{ref.flow.slug}</span>
                      <span className="text-muted">
                        step {ref.number} · #{ref.stepId}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
