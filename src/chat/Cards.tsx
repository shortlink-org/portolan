// What a show_* call draws.
//
// The model names a thing; the card is drawn from the catalog. Nothing on a
// card came out of the model, so nothing on it can be made up: the ids, the
// counts, the arrows and the states are the ones the pages show.

import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Aggregate, BoundedContext, Flow, Service } from "../catalog";
import { Integrations } from "../components/Integrations";
import { LifecycleDiagram } from "../components/LifecycleDiagram";
import { Mermaid } from "../components/Mermaid";
import { KindIcon } from "../components/kind";
import { Empty } from "../components/PageHeader";
import { ContextPill } from "../components/primitives";
import type { Kind } from "../lib/kinds";
import { catalog } from "../data";
import { flowMermaid } from "../flow/mermaid";
import { integrationsFor } from "../lib/integrations";
import type { IntegrationGroup } from "../lib/integrations";
import { paths } from "../routes";

interface Located {
  context: BoundedContext;
  service: Service;
}

interface LocatedAggregate extends Located {
  aggregate: Aggregate;
}

function norm(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/** By id, or by a slug or name that names exactly one thing. */
export function findService(raw: unknown): Located | null {
  const id = norm(raw);
  if (!id) return null;
  const loose: Located[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      if (
        service.id.toLowerCase() === id ||
        `${context.id}.${service.slug}`.toLowerCase() === id
      ) {
        return { context, service };
      }
      if (service.slug.toLowerCase() === id || service.name.toLowerCase() === id)
        loose.push({ context, service });
    }
  }
  return loose.length === 1 ? loose[0]! : null;
}

export function findFlow(raw: unknown): Flow | null {
  const id = norm(raw);
  if (!id) return null;
  return (
    catalog.flows.find(
      (flow) =>
        flow.id.toLowerCase() === id ||
        flow.slug.toLowerCase() === id ||
        flow.name.toLowerCase() === id,
    ) ?? null
  );
}

export function findContext(raw: unknown): BoundedContext | null {
  const id = norm(raw);
  if (!id) return null;
  return (
    catalog.contexts.find(
      (context) =>
        context.id.toLowerCase() === id ||
        context.slug.toLowerCase() === id ||
        context.name.toLowerCase() === id,
    ) ?? null
  );
}

export function findAggregate(raw: unknown): LocatedAggregate | null {
  const id = norm(raw);
  if (!id) return null;
  const loose: LocatedAggregate[] = [];
  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        if (
          aggregate.id.toLowerCase() === id ||
          `${service.id}.${aggregate.slug}`.toLowerCase() === id
        ) {
          return { context, service, aggregate };
        }
        if (
          aggregate.slug.toLowerCase() === id ||
          aggregate.name.toLowerCase() === id
        )
          loose.push({ context, service, aggregate });
      }
    }
  }
  return loose.length === 1 ? loose[0]! : null;
}

type Input = Record<string, unknown>;

function inputOf(raw: unknown): Input {
  return raw && typeof raw === "object" ? (raw as Input) : {};
}

/**
 * What the model is told the call did. Nothing more than "shown" or "not
 * found": the card is for the reader, and the model does not get another
 * turn to talk about it.
 */
export function toolOutput(name: string, raw: unknown): string {
  const input = inputOf(raw);
  switch (name) {
    case "show_service":
      return findService(input.id)
        ? `shown: service ${String(input.id)}`
        : `not in the catalog: ${String(input.id)}; nothing was shown`;
    case "show_flow":
      return findFlow(input.id)
        ? `shown: flow ${String(input.id)}`
        : `not in the catalog: ${String(input.id)}; nothing was shown`;
    case "show_between":
      return findContext(input.a) && findContext(input.b)
        ? `shown: what runs between ${String(input.a)} and ${String(input.b)}`
        : `not in the catalog: ${String(input.a)} or ${String(input.b)}; nothing was shown`;
    case "show_lifecycle":
      return findAggregate(input.aggregate)?.aggregate.lifecycle
        ? `shown: lifecycle of ${String(input.aggregate)}`
        : `no lifecycle in the catalog for ${String(input.aggregate)}; nothing was shown`;
    default:
      return "unknown tool";
  }
}

const CARD = "rounded-card border border-line bg-surface p-3 shadow-xs";

function Missing({ what }: { what: string }) {
  return (
    <div className={CARD}>
      <Empty>not in the catalog: {what}</Empty>
    </div>
  );
}

/**
 * Every card starts the same way: the kind's icon, the name as a link, the
 * id underneath, the context on the right, and one arrow out to the page.
 */
function CardHeader({
  kind,
  title,
  id,
  to,
  context,
  onNavigate,
}: {
  kind: Kind;
  title: string;
  id: string;
  to: string;
  context?: BoundedContext;
  onNavigate: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <KindIcon
        kind={kind}
        {...(context && kind === "context" ? { contextId: context.id } : {})}
        size={16}
        className="mt-1 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <Link
          to={to}
          onClick={onNavigate}
          className="font-semibold text-ink hover:text-accent"
        >
          {title}
        </Link>
        <div className="mono truncate text-muted">{id}</div>
      </div>
      {context ? (
        <Link to={paths.context(context.id)} onClick={onNavigate} className="shrink-0">
          <ContextPill id={context.id} name={context.name} />
        </Link>
      ) : null}
      <Link
        to={to}
        onClick={onNavigate}
        aria-label={`Open ${title}`}
        title="Open the page"
        className="mt-0.5 shrink-0 text-muted transition-colors hover:text-accent"
      >
        <ArrowUpRight size={15} aria-hidden />
      </Link>
    </div>
  );
}

/** A diagram in its own frame, scrolling sideways rather than widening the panel. */
function Figure({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-control border border-line bg-canvas p-2">
      {children}
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function ServiceCard({ id, onNavigate }: { id: unknown; onNavigate: () => void }) {
  const found = findService(id);
  if (!found) return <Missing what={String(id)} />;
  const { context, service } = found;
  const events = service.aggregates.reduce((n, a) => n + a.events.length, 0);
  const facts = [
    plural(service.provides.length, "interface"),
    plural(service.consumes.length, "outbound call"),
    plural(service.aggregates.length, "aggregate"),
    plural(events, "event"),
    ...(service.channels?.length ? [plural(service.channels.length, "channel")] : []),
  ];
  return (
    <div className={CARD}>
      <CardHeader
        kind="service"
        title={service.name}
        id={service.id}
        to={paths.service(context.id, service.slug)}
        context={context}
        onNavigate={onNavigate}
      />
      <div className="mono mt-3 text-muted">{facts.join(" · ")}</div>
      {service.technologies?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {service.technologies.map((tech) => (
            <span key={tech} className="chip border-line">{tech}</span>
          ))}
        </div>
      ) : null}
      {service.owners?.length ? (
        <div className="mono mt-2 text-muted">owned by {service.owners.join(", ")}</div>
      ) : null}
    </div>
  );
}

function FlowCard({ id, onNavigate }: { id: unknown; onNavigate: () => void }) {
  const flow = findFlow(id);
  if (!flow) return <Missing what={String(id)} />;
  return (
    <div className={CARD}>
      <CardHeader
        kind="flow"
        title={flow.name}
        id={flow.id}
        to={paths.flow(flow.slug)}
        onNavigate={onNavigate}
      />
      {flow.summary ? <p className="mt-2 text-muted">{flow.summary}</p> : null}
      <Figure>
        <Mermaid code={flowMermaid(flow)} />
      </Figure>
    </div>
  );
}

/** Every call a service of `from` makes into a service of `to`. */
function callsBetween(from: BoundedContext, to: BoundedContext): IntegrationGroup[] {
  const groups: IntegrationGroup[] = [];
  for (const service of from.services) {
    for (const group of integrationsFor(service, catalog)) {
      if (group.service && to.services.some((s) => s.id === group.service!.id)) {
        groups.push({ ...group, name: `${service.name} → ${group.name}` });
      }
    }
  }
  return groups;
}

function BetweenCard({
  a,
  b,
  onNavigate,
}: {
  a: unknown;
  b: unknown;
  onNavigate: () => void;
}) {
  const left = findContext(a);
  const right = findContext(b);
  if (!left || !right) return <Missing what={`${String(a)} or ${String(b)}`} />;
  const forward = callsBetween(left, right);
  const backward = callsBetween(right, left);
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2.5">
        <KindIcon kind="context" contextId={left.id} size={16} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Link to={paths.context(left.id)} onClick={onNavigate}>
            <ContextPill id={left.id} name={left.name} />
          </Link>
          <span className="mono text-muted">and</span>
          <Link to={paths.context(right.id)} onClick={onNavigate}>
            <ContextPill id={right.id} name={right.name} />
          </Link>
        </div>
      </div>
      {forward.length === 0 && backward.length === 0 ? (
        <div className="mt-2">
          <Empty>no call from either into the other is in the catalog</Empty>
        </div>
      ) : (
        <>
          {forward.length > 0 ? (
            <div className="mt-3">
              <div className="label mb-1">{left.id} → {right.id}</div>
              <Integrations groups={forward} />
            </div>
          ) : null}
          {backward.length > 0 ? (
            <div className="mt-3">
              <div className="label mb-1">{right.id} → {left.id}</div>
              <Integrations groups={backward} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function LifecycleCard({
  id,
  onNavigate,
}: {
  id: unknown;
  onNavigate: () => void;
}) {
  const found = findAggregate(id);
  if (!found) return <Missing what={String(id)} />;
  const { context, service, aggregate } = found;
  return (
    <div className={CARD}>
      <CardHeader
        kind="aggregate"
        title={aggregate.name}
        id={aggregate.id}
        to={paths.aggregate(context.id, service.slug, aggregate.slug)}
        context={context}
        onNavigate={onNavigate}
      />
      {aggregate.lifecycle ? (
        <Figure>
          <LifecycleDiagram
            aggregate={aggregate}
            eventPath={(eventId) => {
              const event = aggregate.events.find((e) => e.id === eventId);
              return event
                ? paths.event(context.id, service.slug, aggregate.slug, event.slug)
                : null;
            }}
          />
        </Figure>
      ) : (
        <div className="mt-2">
          <Empty>this aggregate has no lifecycle in the catalog</Empty>
        </div>
      )}
    </div>
  );
}

export function ToolCard({
  name,
  input: raw,
  onNavigate,
}: {
  name: string;
  input: unknown;
  /** A link on the card was followed: the panel closes. */
  onNavigate: () => void;
}) {
  const input = inputOf(raw);
  switch (name) {
    case "show_service":
      return <ServiceCard id={input.id} onNavigate={onNavigate} />;
    case "show_flow":
      return <FlowCard id={input.id} onNavigate={onNavigate} />;
    case "show_between":
      return <BetweenCard a={input.a} b={input.b} onNavigate={onNavigate} />;
    case "show_lifecycle":
      return <LifecycleCard id={input.aggregate} onNavigate={onNavigate} />;
    default:
      return null;
  }
}
