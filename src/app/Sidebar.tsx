import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useMatch } from "react-router";
import { ChevronRight, Circle } from "lucide-react";
import { catalog } from "../data";
import { coverageRatio, flowCoverage } from "../catalog";
import type {
  Aggregate,
  Block,
  Context,
  Event,
  Operation,
  Service,
} from "../catalog";
import { adrNumber, newestAccepted, sortAdrs } from "../lib/adr";
import { ctxStyle } from "../lib/context-color";
import { KIND_CHIP, LEAF_KINDS } from "../lib/kinds";
import type { LeafKind } from "../lib/kinds";
import { KindIcon } from "../components/kind";
import { isStruck } from "../components/primitives";
import { paths } from "../routes";
import { useSearch } from "./search";
import { resolveSelection, selectionFor } from "../selection/model";
import { selectsInPlace } from "../selection/pages";
import { useSelectionStore } from "../selection/store";

function matches(q: string, ...haystack: string[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return haystack.some((h) => h.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// Filtering. A hit on a parent shows everything under it; otherwise only the
// children that match survive, so the tree never hides what was searched for.
// ---------------------------------------------------------------------------

interface AggregateMatch {
  aggregate: Aggregate;
  valueObjects: Block[];
  entities: Block[];
  events: Event[];
  commands: Operation[];
  queries: Operation[];
}

interface ServiceMatch {
  service: Service;
  aggregates: AggregateMatch[];
}

function matchAggregate(
  aggregate: Aggregate,
  q: string,
  parentHit: boolean,
): AggregateMatch | null {
  const hit =
    parentHit ||
    matches(q, aggregate.id, aggregate.name, aggregate.slug, aggregate.root);
  const keepBlocks = (list: Block[]): Block[] =>
    hit ? list : list.filter((b) => matches(q, b.id, b.name, b.slug));
  const ops = (kind: "command" | "query"): Operation[] => {
    const list = aggregate.operations.filter((o) => o.kind === kind);
    return hit ? list : list.filter((o) => matches(q, o.id));
  };

  const match: AggregateMatch = {
    aggregate,
    valueObjects: keepBlocks(aggregate.valueObjects),
    entities: keepBlocks(aggregate.entities),
    events: hit
      ? aggregate.events
      : aggregate.events.filter((e) => matches(q, e.id, e.name, e.slug)),
    commands: ops("command"),
    queries: ops("query"),
  };

  const anyChild =
    match.valueObjects.length +
      match.entities.length +
      match.events.length +
      match.commands.length +
      match.queries.length >
    0;
  return hit || anyChild ? match : null;
}

function matchContext(
  context: Context,
  q: string,
): { context: Context; services: ServiceMatch[] } | null {
  const contextHit = matches(q, context.id, context.name);
  const services: ServiceMatch[] = [];

  for (const service of context.services) {
    const serviceHit =
      contextHit || matches(q, service.id, service.name, service.slug);
    const aggregates = service.aggregates
      .map((a) => matchAggregate(a, q, serviceHit))
      .filter((a): a is AggregateMatch => a !== null);
    if (serviceHit || aggregates.length > 0) {
      services.push({ service, aggregates });
    }
  }

  if (services.length === 0 && !contextHit) return null;
  return { context, services };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const indent = (depth: number) => 8 + depth * 12;

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={11}
      aria-hidden
      className="shrink-0 transition-transform"
      style={{
        transform: open ? "rotate(90deg)" : "none",
        color: "var(--fg-muted)",
      }}
    />
  );
}

/**
 * Clicking a row always selects. Whether it also navigates is the question the
 * page on screen answers: on a flow page, picking something that flow already
 * draws is a question about that sequence, so the reader stays put.
 */
function useRowClick(selId: string | undefined) {
  const select = useSelectionStore((s) => s.select);
  const { pathname } = useLocation();
  return (e: React.MouseEvent) => {
    if (selId === undefined) return;
    const selection = selectionFor(selId);
    select(selId, "sidebar");
    if (selectsInPlace(pathname, selection)) e.preventDefault();
  };
}

/**
 * A leaf: the whole row navigates. Rows that stand for a selectable entity also
 * carry `selId`, which makes them both a writer of the selection and a reader
 * of it - the row lights up whether it was clicked here, on a diagram, or in
 * the palette.
 */
function Leaf({
  to,
  depth,
  children,
  title,
  selId,
}: {
  to: string;
  depth: number;
  children: React.ReactNode;
  title?: string;
  selId?: string;
}) {
  const selected = useSelectionStore(
    (s) => selId !== undefined && s.selection?.id === selId,
  );
  const onClick = useRowClick(selId);
  return (
    <NavLink
      to={to}
      end
      title={title}
      data-sel={selId}
      onClick={onClick}
      style={({ isActive }) => ({
        paddingLeft: indent(depth),
        background: isActive || selected ? "var(--surface-2)" : undefined,
        borderLeft: `2px solid ${isActive || selected ? "var(--accent)" : "transparent"}`,
      })}
      className="flex items-center gap-1.5 py-[3px] pr-2 hover:bg-surface"
    >
      {children}
    </NavLink>
  );
}

/**
 * A branch: a disclosure triangle that only expands, next to a link that only
 * navigates. Keeping them separate means neither is nested inside the other.
 */
function Branch({
  to,
  depth,
  open,
  onToggle,
  label,
  children,
  right,
  under,
  selId,
}: {
  to: string;
  depth: number;
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
  right?: React.ReactNode;
  under?: React.ReactNode;
  selId?: string;
}) {
  const selected = useSelectionStore(
    (s) => selId !== undefined && s.selection?.id === selId,
  );
  const onClick = useRowClick(selId);
  const active = useMatch({ path: to, end: true }) !== null || selected;
  return (
    <>
      <div
        className="flex items-stretch hover:bg-surface"
        style={{
          paddingLeft: indent(depth),
          background: active ? "var(--surface-2)" : undefined,
          borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          className="flex shrink-0 items-center pr-1"
        >
          <Chevron open={open} />
        </button>
        <NavLink
          to={to}
          end
          data-sel={selId}
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-2"
        >
          {children}
          {right ? <span className="ml-auto shrink-0">{right}</span> : null}
        </NavLink>
      </div>
      {under}
    </>
  );
}

/**
 * A group header inside an aggregate - "value objects (3)". It names a kind
 * rather than a thing, so it has no page and does nothing but open and close.
 */
function Group({
  kind,
  count,
  open,
  onToggle,
  depth,
  children,
}: {
  kind: LeafKind;
  count: number;
  open: boolean;
  onToggle: () => void;
  depth: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ paddingLeft: indent(depth) }}
        className="group-row"
      >
        <Chevron open={open} />
        <KindIcon kind={kind} />
        <span>
          {KIND_GROUP_LABEL[kind]} ({count})
        </span>
      </button>
      {open ? children : null}
    </>
  );
}

const KIND_GROUP_LABEL: Record<LeafKind, string> = {
  vo: "value objects",
  entity: "entities",
  event: "events",
  command: "commands",
  query: "queries",
};

// ---------------------------------------------------------------------------

export function Sidebar() {
  const { query, setQuery, inputRef } = useSearch();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Set<LeafKind>>(new Set());

  const isOpen = (key: string, def: boolean): boolean => collapsed[key] ?? def;
  const toggle = (key: string, def: boolean) =>
    setCollapsed((c) => ({ ...c, [key]: !(c[key] ?? def) }));
  const shows = (kind: LeafKind) => !hidden.has(kind);
  const toggleKind = (kind: LeafKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const flows = useMemo(
    () =>
      catalog.flows.filter((f) =>
        matches(query, f.id, f.slug, f.name, f.summary),
      ),
    [query],
  );

  const contexts = useMemo(
    () =>
      catalog.contexts
        .map((c) => matchContext(c, query))
        .filter(
          (x): x is { context: Context; services: ServiceMatch[] } =>
            x !== null,
        ),
    [query],
  );

  // Unfiltered, this is a standing list of what currently holds. With a filter
  // typed, it searches every decision, including the ones that no longer do.
  const adrs = useMemo(
    () =>
      query.trim()
        ? sortAdrs(
            catalog.adrs.filter((a) =>
              matches(query, a.id, a.slug, a.title, adrNumber(a)),
            ),
          ).slice(0, 8)
        : newestAccepted(catalog, 5),
    [query],
  );

  // While filtering, everything is expanded: hiding matches would defeat the filter.
  const filtering = query.trim().length > 0;

  // --- following the selection --------------------------------------------

  const selection = useSelectionStore((s) => s.selection);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Opening the ancestors is not optional. A selection made on a diagram or in
  // the palette has to be findable in the tree, and a tree row inside three
  // collapsed parents may as well not exist.
  useEffect(() => {
    if (!selection) return;
    const resolved = resolveSelection(selection.id);
    if (!resolved) return;

    const keys: string[] = [];
    if ("context" in resolved) keys.push(`c:${resolved.context.id}`);
    if ("service" in resolved) keys.push(`s:${resolved.service.id}`);
    if ("aggregate" in resolved) keys.push(`a:${resolved.aggregate.id}`);
    if (resolved.kind === "event") {
      keys.push(`a:${resolved.aggregate.id}:event`);
    }
    if (keys.length === 0) return;

    setCollapsed((c) => {
      // Only skip when every ancestor is *explicitly* open. An unset key means
      // "still on its default", which for an aggregate is closed.
      if (keys.every((k) => c[k] === true)) return c;
      const next = { ...c };
      for (const k of keys) next[k] = true;
      return next;
    });

    // A kind switched off by a filter chip would swallow the row silently.
    if (resolved.kind === "event") {
      setHidden((prev) => {
        if (!prev.has("event")) return prev;
        const next = new Set(prev);
        next.delete("event");
        return next;
      });
    }
  }, [selection]);

  // Scroll only when the row is actually out of sight: yanking the tree under
  // a reader who can already see the row is worse than doing nothing.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!selection || !scroller) return;
    const row = scroller.querySelector<HTMLElement>(
      `[data-sel="${CSS.escape(selection.id)}"]`,
    );
    if (!row) return;
    const a = row.getBoundingClientRect();
    const b = scroller.getBoundingClientRect();
    if (a.top >= b.top && a.bottom <= b.bottom) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selection, collapsed, hidden]);

  return (
    <nav
      className="flex h-full flex-col border-r border-line bg-canvas"
      aria-label="Catalog"
    >
      <div className="border-b p-2 border-line">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder="filter"
          spellCheck={false}
          className="mono w-full border bg-transparent px-2 py-1 outline-none placeholder:text-muted border-line"
          aria-label="Filter catalog"
        />
        <div
          className="mt-2 flex flex-wrap gap-1"
          role="group"
          aria-label="Show kinds"
        >
          {LEAF_KINDS.map((kind) => {
            const on = shows(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={on}
                title={`${on ? "Hide" : "Show"} ${KIND_GROUP_LABEL[kind]} across the tree`}
                className="mono inline-flex items-center gap-1 border px-1.5 py-px leading-4"
                style={{
                  borderColor: on ? "var(--border-strong)" : "var(--border)",
                  color: on ? "var(--fg)" : "var(--fg-muted)",
                  opacity: on ? 1 : 0.55,
                  background: on ? "var(--surface)" : "transparent",
                }}
              >
                <KindIcon kind={kind} size={10} />
                {KIND_CHIP[kind]}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto pb-8">
        <div className="label px-2 pt-3 pb-1">Flows</div>
        {flows.length === 0 ? (
          <div className="px-3 py-1 text-muted">no match</div>
        ) : null}
        {flows.map((flow) => {
          const cov = flowCoverage(flow);
          return (
            <Leaf key={flow.slug} to={paths.flow(flow.slug)} depth={0}>
              <KindIcon kind="flow" />
              <span className="mono truncate">{flow.slug}</span>
              {cov.unresolved > 0 ? (
                <Circle
                  size={7}
                  aria-label="has unresolved steps"
                  className="ml-auto shrink-0"
                  style={{
                    color: "var(--status-unresolved)",
                    fill: "var(--status-unresolved)",
                  }}
                />
              ) : (
                <span
                  className="mono ml-auto shrink-0"
                  style={{
                    color:
                      coverageRatio(cov) === 1
                        ? "var(--status-verified)"
                        : "var(--fg-muted)",
                  }}
                >
                  {Math.round(coverageRatio(cov) * 100)}%
                </span>
              )}
            </Leaf>
          );
        })}

        <div className="label px-2 pt-4 pb-1">Domains</div>
        {contexts.length === 0 ? (
          <div className="px-3 py-1 text-muted">no match</div>
        ) : null}
        {contexts.map(({ context, services }) => {
          const ckey = `c:${context.id}`;
          const copen = filtering || isOpen(ckey, true);
          return (
            <div key={context.id}>
              <Branch
                to={paths.context(context.id)}
                depth={0}
                open={copen}
                onToggle={() => toggle(ckey, true)}
                label={`context ${context.id}`}
                selId={context.id}
              >
                <KindIcon kind="context" contextId={context.id} />
                <span className="mono truncate ctx" style={ctxStyle(context.id)}>
                  {context.id}
                </span>
              </Branch>
              {copen
                ? services.map(({ service, aggregates }) => {
                    const skey = `s:${service.id}`;
                    const sopen = filtering || isOpen(skey, true);
                    return (
                      <div key={service.id}>
                        <Branch
                          to={paths.service(context.id, service.slug)}
                          depth={1}
                          open={sopen}
                          onToggle={() => toggle(skey, true)}
                          label={`service ${service.id}`}
                          selId={service.id}
                        >
                          <KindIcon kind="service" />
                          <span className="mono truncate">{service.slug}</span>
                        </Branch>
                        {sopen
                          ? aggregates.map((match) => (
                              <AggregateNode
                                key={match.aggregate.id}
                                match={match}
                                contextId={context.id}
                                serviceSlug={service.slug}
                                filtering={filtering}
                                isOpen={isOpen}
                                toggle={toggle}
                                shows={shows}
                              />
                            ))
                          : null}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}

        <div className="label px-2 pt-4 pb-1">Decisions</div>
        {adrs.length === 0 ? (
          <div className="px-3 py-1 text-muted">no match</div>
        ) : null}
        {adrs.map((adr) => (
          <Leaf key={adr.id} to={paths.adr(adr.slug)} depth={0} title={adr.title}>
            <KindIcon kind="adr" />
            <span
              className={`mono shrink-0 ${isStruck(adr.status) ? "line-through text-muted" : ""}`}
            >
              {adrNumber(adr)}
            </span>
            <span className="truncate text-muted">{adr.title}</span>
          </Leaf>
        ))}
        <NavLink
          to={paths.adrs()}
          className="mono block py-[3px] pr-2 pl-[8px] text-accent hover:bg-surface"
        >
          view all {catalog.adrs.length} →
        </NavLink>
      </div>
    </nav>
  );
}

function AggregateNode({
  match,
  contextId,
  serviceSlug,
  filtering,
  isOpen,
  toggle,
  shows,
}: {
  match: AggregateMatch;
  contextId: string;
  serviceSlug: string;
  filtering: boolean;
  isOpen: (key: string, def: boolean) => boolean;
  toggle: (key: string, def: boolean) => void;
  shows: (kind: LeafKind) => boolean;
}) {
  const { aggregate } = match;
  const akey = `a:${aggregate.id}`;
  const aopen = filtering || isOpen(akey, false);
  const to = paths.aggregate(contextId, serviceSlug, aggregate.slug);

  // Events are the group that opens by itself: they are what other contexts
  // actually depend on. The structural groups stay shut until asked for.
  const group = (kind: LeafKind, def: boolean) => ({
    kind,
    open: filtering || isOpen(`${akey}:${kind}`, def),
    onToggle: () => toggle(`${akey}:${kind}`, def),
  });

  const blockLeaf = (kind: "vo" | "entity", block: Block) => {
    const path =
      kind === "vo"
        ? paths.valueObject(contextId, serviceSlug, aggregate.slug, block.slug)
        : paths.entity(contextId, serviceSlug, aggregate.slug, block.slug);
    return (
      <Leaf key={block.id} to={path} depth={4} title={block.doc}>
        <KindIcon kind={kind} />
        <span className="mono truncate">{block.name}</span>
        {kind === "entity" && block.name === aggregate.root ? (
          <span className="mono ml-auto shrink-0 text-muted">root</span>
        ) : null}
      </Leaf>
    );
  };

  return (
    <div>
      <Branch
        to={to}
        depth={2}
        open={aopen}
        onToggle={() => toggle(akey, false)}
        label={`aggregate ${aggregate.name}`}
        selId={aggregate.id}
        under={
          <div
            className="mono truncate pr-2 text-muted"
            style={{ paddingLeft: indent(3), fontSize: 11 }}
            title={`aggregate root: ${aggregate.root}`}
          >
            root: {aggregate.root}
          </div>
        }
        right={
          aggregate.events.length === 0 ? (
            <span
              className="mono text-muted"
              title="this aggregate publishes no events"
            >
              0
            </span>
          ) : null
        }
      >
        <KindIcon kind="aggregate" />
        <span className="mono truncate font-medium">{aggregate.name}</span>
      </Branch>

      {aopen ? (
        <>
          {shows("vo") ? (
            <Group
              {...group("vo", false)}
              count={match.valueObjects.length}
              depth={3}
            >
              {match.valueObjects.map((b) => blockLeaf("vo", b))}
            </Group>
          ) : null}

          {shows("entity") ? (
            <Group
              {...group("entity", false)}
              count={match.entities.length}
              depth={3}
            >
              {match.entities.map((b) => blockLeaf("entity", b))}
            </Group>
          ) : null}

          {shows("event") ? (
            <Group
              {...group("event", true)}
              count={match.events.length}
              depth={3}
            >
              {match.events.map((event) => {
                const latest = event.versions[event.versions.length - 1];
                return (
                  <Leaf
                    key={event.id}
                    to={paths.event(
                      contextId,
                      serviceSlug,
                      aggregate.slug,
                      event.slug,
                    )}
                    depth={4}
                    selId={event.id}
                  >
                    <KindIcon kind="event" />
                    <span
                      className="mono truncate"
                      style={{ color: "var(--kind-event)" }}
                    >
                      {event.name}
                    </span>
                    {latest ? (
                      <span className="mono ml-auto shrink-0 border px-1 border-line text-muted">
                        {latest.version}
                      </span>
                    ) : null}
                  </Leaf>
                );
              })}
            </Group>
          ) : null}

          {shows("command") ? (
            <Group
              {...group("command", false)}
              count={match.commands.length}
              depth={3}
            >
              {match.commands.map((op) => (
                <Leaf key={op.id} to={`${to}#bb-commands`} depth={4}>
                  <KindIcon kind="command" />
                  <span className="mono truncate text-muted">{op.id}</span>
                </Leaf>
              ))}
            </Group>
          ) : null}

          {shows("query") ? (
            <Group
              {...group("query", false)}
              count={match.queries.length}
              depth={3}
            >
              {match.queries.map((op) => (
                <Leaf key={op.id} to={`${to}#bb-queries`} depth={4}>
                  <KindIcon kind="query" />
                  <span className="mono truncate text-muted">{op.id}</span>
                </Leaf>
              ))}
            </Group>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
