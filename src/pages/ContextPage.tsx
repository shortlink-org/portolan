import { Link, useParams } from "react-router";
import { AlertTriangle } from "lucide-react";
import { catalog } from "../data";
import { contextStats } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { middleTruncate, plural } from "../lib/format";
import { staggerStyle } from "../lib/motion";
import { CONTEXT_ANCHOR, EVENT_ANCHOR, LINKS_HERE, paths } from "../routes";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { ClassificationBadge } from "../components/primitives";
import { KindIcon } from "../components/kind";
import { RowActions } from "../components/RowActions";
import { Toc } from "../components/Toc";
import type { TocItem } from "../components/Toc";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { NotFound } from "./NotFound";
import { C4View } from "../likec4/C4View";
import { contextViewId } from "../likec4/ids";

const TOC: TocItem[] = [
  { id: CONTEXT_ANCHOR.services, label: "Services" },
  { id: CONTEXT_ANCHOR.aggregates, label: "Aggregates" },
  { id: CONTEXT_ANCHOR.events, label: "Events" },
  { id: LINKS_HERE, label: "What links here" },
];

export function ContextPage() {
  const { context: contextId } = useParams();
  const context = catalog.contexts.find((c) => c.id === contextId);
  if (!context) return <NotFound kind="Context" id={contextId} />;
  const stats = contextStats(context);

  // Flattened once, here: a context is read as "what does this domain own",
  // and the answer is not one service deep.
  const aggregates = context.services.flatMap((service) =>
    service.aggregates.map((aggregate) => ({ service, aggregate })),
  );
  const events = aggregates.flatMap(({ service, aggregate }) =>
    aggregate.events.map((event) => ({ service, aggregate, event })),
  );

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind="context"
        name={context.name}
        id={context.id}
        contextId={context.id}
        right={
          <>
            <ClassificationBadge classification={context.classification} />
            {stats.unresolved > 0 ? (
              <Link
                to={paths.problems()}
                className="chip-lg status-unresolved"
                title="see every edge in the estate that lands nowhere"
              >
                <AlertTriangle size={14} aria-hidden />
                {stats.unresolved} unresolved
              </Link>
            ) : null}
          </>
        }
      >
        <p className="mt-2 max-w-prose text-muted">{context.summary}</p>
        {/* Three counts, three sections. None of them is decoration. */}
        <div className="mono mt-3 flex flex-wrap items-center gap-x-4 text-muted">
          <a
            href={`#${CONTEXT_ANCHOR.services}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{stats.services}</span>{" "}
            {plural(stats.services, "service")}
          </a>
          <a
            href={`#${CONTEXT_ANCHOR.aggregates}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{stats.aggregates}</span>{" "}
            {plural(stats.aggregates, "aggregate")}
          </a>
          <a
            href={`#${CONTEXT_ANCHOR.events}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{stats.events}</span>{" "}
            {plural(stats.events, "event")}
          </a>
        </div>
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <SectionTitle>Model</SectionTitle>
          {/* The derived `ctx_<id>` view unless the catalog names another one. */}
          <C4View
            viewId={context.viewId ?? contextViewId(context)}
            height={340}
          />

          {/* --- Services ----------------------------------------------- */}
          <section id={CONTEXT_ANCHOR.services} className="mt-section">
            <SectionTitle anchor={CONTEXT_ANCHOR.services}>
              Services
            </SectionTitle>
            <div
              className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
              data-nav-list
            >
              {context.services.map((service, i) => (
                <div
                  key={service.id}
                  className="card card-tagged stagger-in"
                  style={{ ...staggerStyle(i), ...ctxStyle(context.id) }}
                >
                  <div className="flex items-baseline gap-2">
                    <Link
                      to={paths.service(context.id, service.slug)}
                      data-nav-item
                      className="card-link rounded-control font-semibold"
                      title={service.name}
                    >
                      {service.name}
                    </Link>
                    <Ident value={service.id} className="text-muted" />
                    <RowActions
                      copy={service.id}
                      reveal={service.id}
                      label={service.name}
                    />
                  </div>
                  {/* Each number is a link into the part of the service page
                      that lists what it counted. */}
                  <div className="mono mt-4 flex flex-wrap gap-x-4 text-muted">
                    <Link
                      to={`${paths.service(context.id, service.slug)}#svc-aggregates`}
                      className="rounded-control hover:text-ink"
                    >
                      <span className="tnum">{service.aggregates.length}</span>{" "}
                      {plural(service.aggregates.length, "aggregate")}
                    </Link>
                    <Link
                      to={`${paths.service(context.id, service.slug)}#svc-events`}
                      className="rounded-control hover:text-ink"
                    >
                      <span className="tnum">
                        {service.aggregates.reduce(
                          (n, a) => n + a.events.length,
                          0,
                        )}
                      </span>{" "}
                      events
                    </Link>
                    <Link
                      to={`${paths.service(context.id, service.slug)}?tab=consumes`}
                      className="rounded-control hover:text-ink"
                    >
                      <span className="tnum">{service.consumes.length}</span>{" "}
                      calls out
                    </Link>
                  </div>
                  <div
                    className="mono trunc mt-2 text-muted"
                    title={`${service.repo}/${service.path}`}
                  >
                    {middleTruncate(`${service.repo}/${service.path}`)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* --- Aggregates --------------------------------------------- */}
          <section
            id={CONTEXT_ANCHOR.aggregates}
            className="mt-section max-w-table"
          >
            <SectionTitle
              anchor={CONTEXT_ANCHOR.aggregates}
              right={
                <span className="mono text-muted">
                  every aggregate this domain owns, whichever service holds it
                </span>
              }
            >
              Aggregates
            </SectionTitle>
            {aggregates.length === 0 ? (
              <Empty>this domain owns nothing yet — only services</Empty>
            ) : (
              <div className="flex flex-col gap-1" data-nav-list>
                {aggregates.map(({ service, aggregate }) => (
                  <div key={aggregate.id} className="row gap-2">
                    <KindIcon kind="aggregate" />
                    <Link
                      to={paths.aggregate(
                        context.id,
                        service.slug,
                        aggregate.slug,
                      )}
                      data-nav-item
                      className="mono rounded-control font-medium"
                    >
                      {aggregate.name}
                    </Link>
                    <span className="meta">{service.slug}</span>
                    <span className="meta">root {aggregate.root}</span>
                    <RowActions
                      copy={aggregate.id}
                      reveal={aggregate.id}
                      label={aggregate.name}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* --- Events -------------------------------------------------- */}
          <section
            id={CONTEXT_ANCHOR.events}
            className="mt-section max-w-table"
          >
            <SectionTitle
              anchor={CONTEXT_ANCHOR.events}
              right={
                <span className="mono text-muted">
                  what the rest of the estate hears from here
                </span>
              }
            >
              Events
            </SectionTitle>
            {events.length === 0 ? (
              <Empty>this domain announces nothing — it only listens</Empty>
            ) : (
              <div className="flex flex-col gap-1" data-nav-list>
                {events.map(({ service, aggregate, event }) => {
                  const to = paths.event(
                    context.id,
                    service.slug,
                    aggregate.slug,
                    event.slug,
                  );
                  return (
                    <div key={event.id} className="row gap-2">
                      <KindIcon kind="event" />
                      <Link
                        to={to}
                        data-nav-item
                        className="mono rounded-control"
                        style={{ color: "var(--kind-event)" }}
                      >
                        {event.name}
                      </Link>
                      <span className="mono text-muted">{aggregate.slug}</span>
                      <Link
                        to={`${to}#${EVENT_ANCHOR.consumers}`}
                        className="mono ml-auto rounded-control text-muted hover:text-ink"
                      >
                        <span className="tnum">{event.consumers.length}</span>{" "}
                        {event.consumers.length === 1
                          ? "consumer"
                          : "consumers"}
                      </Link>
                      <RowActions
                        copy={event.id}
                        reveal={event.id}
                        label={event.name}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Traffic that starts outside. What its own services call each
              other is wiring, not something the domain is depended on for. */}
          <WhatLinksHere
            target={{ kind: "context", id: context.id }}
            empty="nothing outside this context names anything inside it"
          />
        </div>

        <Toc items={TOC} label="Sections of this context" />
      </div>
    </div>
  );
}
