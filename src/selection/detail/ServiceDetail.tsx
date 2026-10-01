import { Link } from "react-router";
import { catalog } from "../../data";
import { allRepos, walkSteps } from "../../catalog";
import { flowsForService } from "../../lib/derive";
import { treeHref } from "../../lib/source-link";
import { methodCount } from "../../lib/api";
import { Ident } from "../../components/Ident";
import { StatusChip } from "../../components/primitives";
import { EVENT_ANCHOR, eventPath as eventPathOf, paths } from "../../routes";
import type { Resolved } from "../model";
import { PanelSection, SelectLink } from "./shared";

export function ServiceBody({
  resolved,
}: {
  resolved: Extract<Resolved, { kind: "service" }>;
}) {
  const { service, context } = resolved;
  const methods = methodCount(service);
  const events = service.aggregates.flatMap((a) => a.events);
  const unresolved = service.consumes.filter((c) => c.status === "unresolved");
  const tree = treeHref(service.path, service, allRepos(catalog));
  // Each flow this service takes part in, opened on the first step it is
  // on either end of - where it enters the story, not the top of the rail.
  const appearances = flowsForService(catalog, service.id).map((flow) => {
    const steps = walkSteps(flow.steps);
    const at = steps.findIndex(
      (s) => s.from === service.id || s.to === service.id,
    );
    return { flow, step: at >= 0 ? steps[at] : undefined, number: at + 1 };
  });

  return (
    <section
      aria-label="Service details"
      className="overflow-hidden rounded-card border shadow-xs border-line"
    >
      <PanelSection title="Source">
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt className="mono text-muted">Repository</dt>
          <dd className="min-w-0">
            <Ident block value={service.repo} className="text-ink" />
          </dd>
          <dt className="mono text-muted">Path</dt>
          <dd className="min-w-0">
            <Ident block value={service.path} className="text-ink" />
          </dd>
        </dl>
        {tree ? (
          <a
            href={tree}
            target="_blank"
            rel="noreferrer"
            className="mono mt-2 inline-flex items-center rounded-control border px-2 py-1 border-line bg-canvas text-accent hover:bg-raised"
            title="Open the service directory on the forge, at the built commit"
          >
            forge ↗
          </a>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Provides"
        meta={`${methods} method${methods === 1 ? "" : "s"}`}
      >
        {/* The count opens the tab that lists the interfaces it counted. */}
        <Link
          to={`${paths.service(context.id, service.slug)}?tab=provides`}
          className="mono rounded-control text-muted hover:text-ink hover:underline"
        >
          {service.provides.length} interface
          {service.provides.length === 1 ? "" : "s"} →
        </Link>
        {service.provides.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1">
            {service.provides.map((provided) => (
              <Ident
                block
                key={provided.id}
                value={provided.id}
                className="text-ink"
              />
            ))}
          </div>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Consumes"
        meta={`${service.consumes.length} call${service.consumes.length === 1 ? "" : "s"}`}
      >
        {service.consumes.length === 0 ? (
          <div className="mono text-muted">this service calls nobody</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {service.consumes.map((call) => (
              <div key={call.id} className="flex flex-wrap items-center gap-2">
                <Ident value={call.id} />
                <StatusChip status={call.status} title={call.note} />
              </div>
            ))}
          </div>
        )}
        {unresolved.length > 0 ? (
          <Link
            to={paths.problems()}
            className="mono mt-2 block rounded-control text-unresolved hover:underline"
          >
            <span className="tnum">{unresolved.length}</span> call
            {unresolved.length === 1 ? "" : "s"} resolve to nothing in the
            catalog →
          </Link>
        ) : null}
      </PanelSection>

      <PanelSection
        title="Publishes"
        meta={`${events.length} event${events.length === 1 ? "" : "s"}`}
      >
        {events.length === 0 ? (
          <div className="mono text-muted">no events</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center gap-2">
                <SelectLink id={event.id}>{event.name}</SelectLink>
                <Link
                  to={`${eventPathOf(event.id) ?? paths.service(context.id, service.slug)}#${EVENT_ANCHOR.consumers}`}
                  title={`${event.consumers.length} consumers of ${event.name}`}
                  className="mono tnum shrink-0 rounded-control text-muted hover:text-ink"
                >
                  {event.consumers.length} consumers
                </Link>
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection title="Appears in flows" meta={appearances.length}>
        {appearances.length === 0 ? (
          <div className="mono text-muted">appears in no flow</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {appearances.map(({ flow, step, number }) => (
              <Link
                key={flow.slug}
                to={
                  step
                    ? paths.flowStep(flow.slug, step.id)
                    : paths.flow(flow.slug)
                }
                className="mono flex min-w-0 flex-wrap items-baseline gap-x-2 text-accent"
                title={step ? `${flow.name}, from step ${number}` : flow.name}
              >
                <span className="min-w-0 truncate">{flow.slug}</span>
                {step ? (
                  <span className="shrink-0 text-muted">step {number}</span>
                ) : null}
                <span aria-hidden>→</span>
              </Link>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection title="Context">
        <SelectLink id={context.id}>{context.id}</SelectLink>
      </PanelSection>
    </section>
  );
}
