import { Link, useParams } from "react-router";
import { AlertTriangle } from "lucide-react";
import { catalog } from "../data";
import { componentKind, groupKind, ownersOf, technologiesOf } from "../catalog";
import { contextOwners, contextStats } from "../lib/derive";
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
import { LevelBadge } from "../likec4/levels";
import { contextViewId } from "../likec4/ids";

export function ContextPage() {
  const { context: contextId } = useParams();
  const context = catalog.contexts.find((c) => c.id === contextId);
  if (!context) return <NotFound kind="Context" id={contextId} />;
  const stats = contextStats(context);
  const owners = contextOwners(context);

  // Flattened once, here: a context is read as "what does this domain own",
  // and the answer is not one service deep.
  const aggregates = context.services.flatMap((service) =>
    service.aggregates.map((aggregate) => ({ service, aggregate })),
  );
  const events = aggregates.flatMap(({ service, aggregate }) =>
    aggregate.events.map((event) => ({ service, aggregate, event })),
  );
  const neutral = groupKind(context) !== "bounded-context";
  const showDomain = !neutral || aggregates.length > 0;
  const toc: TocItem[] = [
    { id: CONTEXT_ANCHOR.services, label: neutral ? "Components" : "Services" },
    ...(showDomain
      ? [
          { id: CONTEXT_ANCHOR.aggregates, label: "Aggregates" },
          { id: CONTEXT_ANCHOR.events, label: "Events" },
        ]
      : []),
    { id: LINKS_HERE, label: "What links here" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind="context"
        name={context.name}
        id={context.id}
        contextId={context.id}
        pin={{ kind: "context", id: context.id }}
        right={
          <>
            <span className="chip-lg">{groupKind(context)}</span>
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
            {plural(stats.services, neutral ? "component" : "service")}
          </a>
          {showDomain ? (
            <>
              <a href={`#${CONTEXT_ANCHOR.aggregates}`} className="rounded-control hover:text-ink">
                <span className="tnum">{stats.aggregates}</span>{" "}{plural(stats.aggregates, "aggregate")}
              </a>
              <a href={`#${CONTEXT_ANCHOR.events}`} className="rounded-control hover:text-ink">
                <span className="tnum">{stats.events}</span>{" "}{plural(stats.events, "event")}
              </a>
            </>
          ) : null}
        </div>
        {/* Who to ask about the whole domain, folded up from what its
            services' CODEOWNERS say - the context itself names nobody. The
            widest owner comes first; each handle says which services it
            stands behind, and is copied rather than linked, as on a service
            page. Absent is absent. */}
        {owners.length > 0 ? (
          <div className="mono mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>ask</span>
            {owners.map(({ handle, services }) => (
              <Ident
                key={handle}
                value={handle}
                title={`${handle} owns ${services.length} of ${context.services.length}: ${services.map((s) => s.slug).join(", ")}`}
              >
                {middleTruncate(handle, 28)}
                {services.length < context.services.length ? (
                  <span className="text-muted"> ·{services.length}</span>
                ) : null}
              </Ident>
            ))}
          </div>
        ) : null}
      </PageHeader>

      <div className="flex gap-section p-gutter">
        <div className="min-w-0 flex-1">
          <SectionTitle right={<LevelBadge level={2} />}>Model</SectionTitle>
          {/* The derived `ctx_<id>` view unless the catalog names another one.
              Containers: the services of this context, the stores they own,
              and any store they read that somebody else owns. */}
          <C4View
            viewId={context.viewId ?? contextViewId(context)}
            height={400}
          />

          {/* --- Services ----------------------------------------------- */}
          <section id={CONTEXT_ANCHOR.services} className="mt-section">
            <SectionTitle anchor={CONTEXT_ANCHOR.services}>
              {neutral ? "Components" : "Services"}
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
                    <span className="chip">{componentKind(service)}</span>
                  </div>
                  {/* Each number is a link into the part of the service page
                      that lists what it counted. */}
                  <div className="mono mt-4 flex flex-wrap gap-x-4 text-muted">
                    {service.aggregates.length > 0 || componentKind(service) === "service" ? (
                      <Link to={`${paths.service(context.id, service.slug)}#svc-aggregates`} className="rounded-control hover:text-ink">
                        <span className="tnum">{service.aggregates.length}</span>{" "}{plural(service.aggregates.length, "aggregate")}
                      </Link>
                    ) : null}
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
                  {technologiesOf(service).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {technologiesOf(service).map((technology) => (
                        <span key={technology} className="chip">{technology}</span>
                      ))}
                    </div>
                  ) : null}
                  {/* Who to ask, when the estate's CODEOWNERS says. Absent is
                      absent: a card that read "owned by nobody" would be
                      making a claim the file never makes. */}
                  {ownersOf(service).length > 0 ? (
                    <div
                      className="mono trunc mt-1 text-muted"
                      title={`Who to ask: ${ownersOf(service).join(", ")}`}
                    >
                      {middleTruncate(ownersOf(service).join(" · "))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {/* --- Aggregates --------------------------------------------- */}
          {showDomain ? <section
            id={CONTEXT_ANCHOR.aggregates}
            className="mt-section max-w-table"
          >
            <SectionTitle
              anchor={CONTEXT_ANCHOR.aggregates}
              right={
                <span>
                  every aggregate this domain owns, whichever service holds it
                </span>
              }
            >
              Aggregates
            </SectionTitle>
            {aggregates.length === 0 ? (
              <Empty>this domain owns nothing yet — only services</Empty>
            ) : (
              /* icon, name, holder, root - one column each, so the eye
                 reads a column instead of hunting along each line. */
              <div
                className="rows grid-cols-[auto_auto_auto_1fr_auto]"
                data-nav-list
              >
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
          </section> : null}

          {/* --- Events -------------------------------------------------- */}
          {showDomain ? <section
            id={CONTEXT_ANCHOR.events}
            className="mt-section max-w-table"
          >
            <SectionTitle
              anchor={CONTEXT_ANCHOR.events}
              right={
                <span>
                  what the rest of the estate hears from here
                </span>
              }
            >
              Events
            </SectionTitle>
            {events.length === 0 ? (
              <Empty>this domain announces nothing — it only listens</Empty>
            ) : (
              <div
                className="rows grid-cols-[auto_auto_1fr_auto_auto]"
                data-nav-list
              >
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
                        className="mono rounded-control text-muted hover:text-ink"
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
          </section> : null}

          {/* Traffic that starts outside. What its own services call each
              other is wiring, not something the domain is depended on for. */}
          <WhatLinksHere
            target={{ kind: "context", id: context.id }}
            empty="nothing outside this context names anything inside it"
          />
        </div>

        <Toc items={toc} label={`Sections of this ${neutral ? "group" : "context"}`} />
      </div>
    </div>
  );
}
