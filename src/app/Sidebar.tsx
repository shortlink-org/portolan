import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useMatch } from "react-router";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
  Check,
  ChevronRight,
  Filter,
  GripVertical,
  PanelLeftOpen,
  PinOff,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { catalog, index } from "../data";
import type {
  Aggregate,
  Block,
  BoundedContext,
  Classification,
  Event,
  Operation,
  RpcMethod,
  RpcService,
  Service,
  Store,
  Table,
  View,
} from "../catalog";
import { allModules, allTerms, storeViews } from "../catalog";
import { adrNumber, newestAccepted, sortAdrs } from "../lib/adr";
import { contextName, ctxStyle } from "../lib/context-color";
import { contextStats, problems } from "../lib/derive";
import { dataProblems } from "../lib/data-problems";
import { protoProblems } from "../lib/proto-problems";
import { matchModules } from "../lib/registry";
import { matchTerms, vocabularies } from "../language/cards";
import {
  FLOW_HEALTH_NOTE,
  groupFlowsByOwner,
  reachDots,
  visibleEntries,
} from "../lib/flow-tree";
import type { FlowEntry, FlowHealth, FlowGroup } from "../lib/flow-tree";
import { KIND_CHIP, LEAF_KINDS, LEAF_KIND_ROWS } from "../lib/kinds";
import type { Kind, LeafKind } from "../lib/kinds";
import { plural } from "../lib/format";
import {
  FLOW_GROUPS_KEY,
  SECTIONS_KEY,
  readFlags,
  writeFlags,
} from "../lib/sidebar-prefs";
import type { Flags } from "../lib/sidebar-prefs";
import { KindIcon } from "../components/kind";
import { CompassRose, Wordmark } from "../components/logo";
import { isStruck } from "../components/primitives";
import { packageAnchor, paths } from "../routes";
import { selectionHash } from "../selection/hash";
import { STORE_KIND_LABEL } from "../er/StoreHeader";
import { useSearch } from "./search";
import { resolvePin, usePinsStore } from "./pins";
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

interface StoreMatch {
  store: Store;
  tables: Table[];
  views: View[];
}

interface ServiceMatch {
  service: Service;
  aggregates: AggregateMatch[];
  endpoints: EndpointMatch[];
  stores: StoreMatch[];
}

interface EndpointMatch {
  provided: RpcService;
  methods: RpcMethod[];
}

/**
 * What the service answers, filtered. A hit on the interface keeps every
 * method it declares; otherwise only the methods that matched survive, exactly
 * like an aggregate or a store.
 */
function matchEndpoints(
  service: Service,
  q: string,
  parentHit: boolean,
): EndpointMatch[] {
  const out: EndpointMatch[] = [];

  for (const provided of service.provides) {
    const hit = parentHit || matches(q, provided.id, provided.source);
    const methods = hit
      ? provided.methods
      : provided.methods.filter((method) =>
          matches(q, method.name, `${provided.id}/${method.name}`),
        );
    if (hit || methods.length > 0) out.push({ provided, methods });
  }

  return out;
}

/**
 * The stores a service owns, filtered. A hit on the store keeps every table and
 * view; otherwise only the ones that matched survive, exactly like an
 * aggregate. Read-only stores are left out: the tree is a map of what each
 * service is responsible for, and a store it borrows belongs under its owner.
 */
function matchStores(
  service: Service,
  q: string,
  parentHit: boolean,
): StoreMatch[] {
  const out: StoreMatch[] = [];
  for (const store of catalog.stores ?? []) {
    if (store.owner !== service.id) continue;
    const hit = parentHit || matches(q, store.id, store.name, store.slug);
    const tables = hit
      ? store.tables
      : store.tables.filter((t) =>
          matches(q, t.id, t.name, t.persists?.aggregate ?? ""),
        );
    const views = hit
      ? storeViews(store)
      : storeViews(store).filter((v) =>
          matches(q, v.id, v.name, v.persists?.aggregate ?? ""),
        );
    if (hit || tables.length > 0 || views.length > 0) {
      out.push({ store, tables, views });
    }
  }
  return out;
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
  context: BoundedContext,
  q: string,
): { context: BoundedContext; services: ServiceMatch[] } | null {
  const contextHit = matches(q, context.id, context.name);
  const services: ServiceMatch[] = [];

  for (const service of context.services) {
    const serviceHit =
      contextHit || matches(q, service.id, service.name, service.slug);
    const aggregates = service.aggregates
      .map((a) => matchAggregate(a, q, serviceHit))
      .filter((a): a is AggregateMatch => a !== null);
    const endpoints = matchEndpoints(service, q, serviceHit);
    const stores = matchStores(service, q, serviceHit);
    if (
      serviceHit ||
      aggregates.length > 0 ||
      endpoints.length > 0 ||
      stores.length > 0
    ) {
      services.push({ service, aggregates, endpoints, stores });
    }
  }

  if (services.length === 0 && !contextHit) return null;
  return { context, services };
}

/**
 * Contexts, in the order the reader should meet them: where the estate
 * competes first, what holds it up next, what it bought last, and what it has
 * not yet rated at the end. This is the ONE place classification orders
 * anything - everywhere else it is a badge and nothing more.
 */
const CLASSIFICATION_ORDER: Record<Classification, number> = {
  core: 0,
  supporting: 1,
  generic: 2,
};

function classificationRank(c: Classification | undefined): number {
  return c === undefined ? 3 : CLASSIFICATION_ORDER[c];
}

const CLASSIFICATION_NOTE: Record<Classification, string> = {
  core: "core domain - where this estate competes",
  supporting: "supporting domain - needed here, but not a differentiator",
  generic: "generic domain - a solved problem, bought or borrowed",
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const indent = (depth: number) => 8 + depth * 12;

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={14}
      aria-hidden
      className="block shrink-0 t-micro transition-transform"
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
        borderLeftWidth: 2,
        borderLeftStyle: "solid",
        borderLeftColor: isActive || selected ? "var(--accent)" : "transparent",
      })}
      /* The edge is always 2px, transparent when idle: lighting a row must not
         shift the text beside it. `pulse-once` keys off `selected` so the
         outline runs exactly once, on the row that just became the selection. */
      data-nav-item
      className={`tree-row flex items-center gap-1.5 py-[3px] pr-2 t-micro transition-colors hover:bg-surface ${
        selected ? "pulse-once" : ""
      }`}
    >
      {children}
    </NavLink>
  );
}

/**
 * A branch: a disclosure triangle that only expands, next to a link that only
 * navigates. Keeping them separate means neither is nested inside the other.
 *
 * `end` is for controls that must be their own target - the unresolved-edge
 * count on a context, which goes somewhere else entirely. It sits OUTSIDE the
 * link, because an anchor may not contain another one, and the link gives up
 * its claim on the rest of the row to make room for it.
 */
function Branch({
  to,
  depth,
  open,
  onToggle,
  label,
  children,
  right,
  end,
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
  end?: React.ReactNode;
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
        className={`tree-row group flex items-stretch t-micro transition-colors hover:bg-surface ${
          selected ? "pulse-once" : ""
        }`}
        style={{
          paddingLeft: indent(depth),
          background: active ? "var(--surface-2)" : undefined,
          borderLeftWidth: 2,
          borderLeftStyle: "solid",
          borderLeftColor: active ? "var(--accent)" : "transparent",
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
          data-nav-item
          onClick={onClick}
          className={`flex min-w-0 items-center gap-1.5 py-[3px] pr-2 ${
            end ? "shrink" : "flex-1"
          }`}
        >
          {children}
          {right && !end ? (
            <span className="ml-auto shrink-0">{right}</span>
          ) : null}
        </NavLink>
        {end}
        {right && end ? (
          <span className="flex shrink-0 items-center pr-2">{right}</span>
        ) : null}
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
  label,
  count,
  open,
  onToggle,
  depth,
  children,
}: {
  kind: LeafKind;
  /** Overrides the kind's own plural — the stores group is "data", not "tables". */
  label?: string;
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
        className="tree-row group-row"
      >
        <Chevron open={open} />
        <KindIcon kind={kind} />
        <span>
          {label ?? KIND_GROUP_LABEL[kind]} ({count})
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
  endpoint: "api",
  table: "tables",
  view: "views",
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * A top-level band of the tree. Its header folds it and always states its size:
 * a folded section that also hid its count would be indistinguishable from an
 * empty one, and the reader would have to open it to find out which.
 *
 * 12px above the header and nothing else between sections. The tree is one
 * continuous list; boxing each band would make a reader count boxes.
 */
function Section({
  title,
  count,
  open,
  onToggle,
  first = false,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** The first section needs no air above it - the filter box is already there. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={first ? "" : "mt-3"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="sb-section"
      >
        <Chevron open={open} />
        {title}
        <span className="sb-count">{count}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

/**
 * A section of the tree with nothing under it. "no match" is an answer to the
 * filter box; before the filter box is touched it accuses the reader of
 * hiding something they never hid, so the two silences say different things.
 */
function TreeNote({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-muted">{children}</div>;
}

// ---------------------------------------------------------------------------
// The kind filter. Seven switches that used to sit under the box permanently,
// now behind the funnel beside it.
//
// They are hidden by default because they answer a question a reader asks once
// a week - "stop showing me tables" - while costing two rows of the one pane
// that is always on screen. What is NOT hidden is the consequence: the moment a
// kind is off, the funnel carries a dot and a line under the box names what is
// missing, because a tree quietly leaving rows out is a tree that lies.
// ---------------------------------------------------------------------------

function KindFilter({
  hidden,
  onToggle,
  onReset,
}: {
  hidden: Set<LeafKind>;
  onToggle: (kind: LeafKind) => void;
  onReset: () => void;
}) {
  const any = hidden.size > 0;
  return (
    <Popover className="relative shrink-0">
      <PopoverButton
        aria-label={
          any
            ? `Kinds shown — ${hidden.size} hidden`
            : "Kinds shown — all of them"
        }
        title={any ? "Kinds shown — some are hidden" : "Kinds shown"}
        className={({ open }) =>
          `relative flex size-8 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${
            open || any ? "text-accent" : "text-muted hover:text-ink"
          }`
        }
      >
        <Filter size={15} aria-hidden />
        {any ? (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
          />
        ) : null}
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 w-72 rounded-control border bg-canvas p-2 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label mb-1.5 px-1">show kinds</div>
        {/* A row per group: what an aggregate holds, what the service
            answers, what a store holds. Seven labels on one row ellipsized
            every one of them, and the break lands where the meaning does. */}
        <div className="seg-stack w-full" role="group" aria-label="Show kinds">
          {LEAF_KIND_ROWS.map((row) => (
            <div key={row[0]} className="seg">
              {row.map((kind) => {
                const on = !hidden.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onToggle(kind)}
                    aria-pressed={on}
                    title={`${on ? "Hide" : "Show"} ${KIND_GROUP_LABEL[kind]} across the tree`}
                    className={`min-w-0 flex-auto truncate text-center !px-1.5 ${
                      on ? "is-on" : ""
                    }`}
                  >
                    {KIND_CHIP[kind]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {any ? (
          <button
            type="button"
            onClick={onReset}
            className="mono mt-2 w-full rounded-control px-1 py-1 text-left text-accent hover:bg-surface"
          >
            show every kind
          </button>
        ) : null}
      </PopoverPanel>
    </Popover>
  );
}

/** What the tree is leaving out, in words, with the way back beside it. */
function HidingLine({
  hidden,
  onReset,
}: {
  hidden: Set<LeafKind>;
  onReset: () => void;
}) {
  const names = [...LEAF_KINDS]
    .filter((k) => hidden.has(k))
    .map((k) => KIND_GROUP_LABEL[k]);
  if (names.length === 0) return null;
  return (
    <div className="mono mt-1.5 flex items-center gap-1.5 text-muted">
      <span className="trunc" title={`hiding: ${names.join(", ")}`}>
        hiding: {names.join(", ")}
      </span>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 rounded-control text-accent hover:underline"
      >
        reset
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

const HEALTH_COLOR: Record<FlowHealth, string> = {
  unresolved: "var(--status-unresolved)",
  declared: "var(--fg-faint)",
  verified: "var(--status-verified)",
};

/**
 * One flow. Its name is what the row is for; the two marks at the end answer
 * the two questions a reader has before opening it - how far does it travel,
 * and can I believe it.
 */
function FlowRow({ entry }: { entry: FlowEntry }) {
  const { flow, health, reach } = entry;
  const { dots, more } = reachDots(reach);
  const crosses =
    reach.length === 0
      ? "stays inside its own context"
      : `crosses into ${reach.join(", ")}`;
  return (
    <Leaf
      to={paths.flow(flow.slug)}
      depth={1}
      title={`${flow.slug} — ${crosses}`}
    >
      <KindIcon kind="flow" />
      <span className="truncate">{flow.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
        <span className="flex items-center gap-0.5" aria-hidden>
          {dots.map((c) => (
            <span key={c} className="sb-reach" style={ctxStyle(c)} />
          ))}
          {more > 0 ? (
            <span className="mono" style={{ color: "var(--fg-faint)" }}>
              +{more}
            </span>
          ) : null}
        </span>
        <span
          className="sb-health"
          title={FLOW_HEALTH_NOTE[health]}
          style={{ background: HEALTH_COLOR[health] }}
        />
      </span>
    </Leaf>
  );
}

/**
 * The flows one context owns. Grouping them by owner rather than listing them
 * flat is what makes the section answer "whose flows are these" - and the
 * unowned group is a defect report: with a valid catalog it is never drawn.
 */
function FlowGroupNode({
  group,
  open,
  onToggle,
}: {
  group: FlowGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const { shown, hidden } = visibleEntries(group.entries);
  const owner = group.owner;
  const label = owner === null ? "unowned" : contextName(owner);
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ paddingLeft: indent(0) }}
        title={
          owner === null
            ? "these flows name no owner — a valid catalog has none of these"
            : `flows owned by ${owner}`
        }
        className="tree-row flex w-full items-center gap-1.5 py-[3px] pr-2 text-left t-micro transition-colors hover:bg-surface"
      >
        <Chevron open={open} />
        {owner === null ? (
          <TriangleAlert
            size={13}
            aria-hidden
            className="block shrink-0 text-unresolved"
          />
        ) : (
          <KindIcon kind="context" contextId={owner} />
        )}
        <span
          className="truncate"
          style={owner === null ? { color: "var(--status-unresolved)" } : {}}
        >
          {label}
        </span>
        <span className="sb-count">{group.entries.length}</span>
      </button>
      {open ? (
        <>
          {shown.map((entry) => (
            <FlowRow key={entry.flow.slug} entry={entry} />
          ))}
          {hidden > 0 && owner !== null ? (
            <NavLink
              to={`${paths.flows()}?owner=${encodeURIComponent(owner)}`}
              data-nav-item
              style={{ paddingLeft: indent(1) }}
              className="tree-row mono flex items-center py-[3px] pr-2 text-accent hover:bg-surface"
            >
              view all {group.entries.length} →
            </NavLink>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

/**
 * The reader's own shortlist, above everything the catalog decided. It only
 * exists while there is something on it: an empty band with a header would
 * teach the feature by taking up room, which is the one thing the pane cannot
 * spare.
 */
function PinnedSection({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const pins = usePinsStore((s) => s.pins);
  const toggle = usePinsStore((s) => s.toggle);
  const reorder = usePinsStore((s) => s.reorder);
  // Which row is under the cursor is a ref, not state: a drop fires in the same
  // gesture that started the drag, and a state write scheduled by `dragstart`
  // is not guaranteed to have landed by the time `drop` reads it. The state
  // beside it only dims the row, so it is allowed to arrive late.
  const dragFrom = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  // Resolved at render, so a pin taken against a build that no longer has the
  // event simply stops being drawn rather than pointing into nothing.
  const rows = useMemo(
    () =>
      pins
        .map((pin, at) => ({ at, resolved: resolvePin(pin) }))
        .filter(
          (r): r is { at: number; resolved: NonNullable<typeof r.resolved> } =>
            r.resolved !== null,
        ),
    [pins],
  );
  if (rows.length === 0) return null;

  return (
    <Section
      title="Pinned"
      count={rows.length}
      open={open}
      onToggle={onToggle}
      first
    >
      {rows.map(({ at, resolved }) => (
        <div
          key={`${resolved.pin.kind}:${resolved.pin.id}`}
          draggable
          onDragStart={(e) => {
            dragFrom.current = at;
            e.dataTransfer.effectAllowed = "move";
            setDragging(at);
          }}
          onDragEnd={() => {
            dragFrom.current = null;
            setDragging(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = dragFrom.current;
            if (from !== null) reorder(from, at);
            dragFrom.current = null;
            setDragging(null);
          }}
          className={`group relative flex items-stretch ${
            dragging === at ? "opacity-50" : ""
          }`}
        >
          <NavLink
            to={resolved.path}
            end
            draggable={false}
            data-nav-item
            title={resolved.title}
            style={({ isActive }) => ({
              paddingLeft: indent(0),
              background: isActive ? "var(--surface-2)" : undefined,
              borderLeftWidth: 2,
              borderLeftStyle: "solid",
              borderLeftColor: isActive ? "var(--accent)" : "transparent",
            })}
            className="tree-row flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-2 t-micro transition-colors hover:bg-surface"
          >
            <GripVertical
              size={12}
              aria-hidden
              className="block shrink-0 opacity-0 group-hover:opacity-100"
              style={{ color: "var(--fg-faint)" }}
            />
            <KindIcon
              kind={resolved.kind}
              {...(resolved.contextId ? { contextId: resolved.contextId } : {})}
            />
            <span className="truncate">{resolved.name}</span>
          </NavLink>
          <button
            type="button"
            onClick={() => toggle(resolved.pin)}
            aria-label={`Unpin ${resolved.name}`}
            title={`Unpin ${resolved.name}`}
            className="flex shrink-0 items-center px-2 text-muted opacity-0 t-micro transition-opacity hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
          >
            <PinOff size={13} aria-hidden />
          </button>
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The bottom group. A sibling of the scroller rather than a row inside it, so
// "pinned to the bottom" is a fact about the layout and not about how far the
// tree happens to have been scrolled.
// ---------------------------------------------------------------------------

function BottomGroup() {
  // Both halves of the Problems page, because that is what the row opens. The
  // badge is red while anything on it is an error and amber when only the
  // schema disagrees with itself - a page of warnings is not a clean estate,
  // and a green tick over it would be the one lie the row can tell.
  const found = useMemo(
    () => [
      ...problems(catalog),
      ...protoProblems(catalog, index),
      ...dataProblems(catalog, index),
    ],
    [],
  );
  const errors = found.filter((p) => p.severity === "error").length;
  const colour =
    errors > 0 ? "var(--status-unresolved)" : "var(--status-declared)";

  return (
    <div className="shrink-0 border-t bg-canvas border-line py-0.5">
      <NavLink
        to={paths.problems()}
        end
        data-nav-item
        aria-keyshortcuts="g p"
        title={
          found.length === 0
            ? "Problems — every edge in the catalog lands somewhere"
            : `Problems — ${found.length} to look at`
        }
        style={({ isActive }) => ({
          paddingLeft: indent(0),
          background: isActive ? "var(--surface-2)" : undefined,
          borderLeftWidth: 2,
          borderLeftStyle: "solid",
          borderLeftColor: isActive ? "var(--accent)" : "transparent",
        })}
        className="tree-row flex items-center gap-1.5 py-[3px] pr-2 t-micro transition-colors hover:bg-surface"
      >
        <TriangleAlert
          size={14}
          aria-hidden
          className="block shrink-0"
          style={{ color: found.length === 0 ? "var(--fg-muted)" : colour }}
        />
        <span className="truncate">Problems</span>
        {found.length === 0 ? (
          <Check
            size={13}
            aria-hidden
            className="ml-auto block shrink-0 text-muted"
          />
        ) : (
          <span
            className="mono tnum ml-auto shrink-0"
            style={{ color: colour }}
          >
            {found.length}
          </span>
        )}
      </NavLink>
      <NavLink
        to={paths.settings()}
        end
        data-nav-item
        title="Settings — projects, plugins and appearance"
        style={({ isActive }) => ({
          paddingLeft: indent(0),
          background: isActive ? "var(--surface-2)" : undefined,
          borderLeftWidth: 2,
          borderLeftStyle: "solid",
          borderLeftColor: isActive ? "var(--accent)" : "transparent",
        })}
        className="tree-row flex items-center gap-1.5 py-[3px] pr-2 text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
      >
        <Settings2 size={14} aria-hidden className="block shrink-0" />
        <span className="truncate">Settings</span>
      </NavLink>
    </div>
  );
}

/**
 * What is left of the tree at 48px. Not a menu: every button here does the one
 * thing the rail can honestly offer, which is to give the tree its width back
 * and land the reader on the section they pointed at.
 */
function IconRail({ onExpand }: { onExpand: () => void }) {
  const sections: { key: string; kind: Kind; label: string }[] = [
    { key: "flows", kind: "flow", label: "Flows" },
    { key: "domains", kind: "context", label: "Domains" },
    // Conditional for the same reason the band is: at 48px a button that opens
    // an empty section is worse than no button.
    ...(allModules(catalog).length > 0
      ? [{ key: "registry", kind: "module" as Kind, label: "Registry" }]
      : []),
    { key: "adrs", kind: "adr", label: "Decisions" },
  ];
  return (
    <nav
      className="flex h-full flex-col items-center gap-1 border-r py-3 border-line bg-canvas"
      aria-label="Catalog (collapsed)"
    >
      {/* The mark survives the collapse; the wordmark does not fit and is not
          missed - at 48px the rose is the whole identity. */}
      <CompassRose size={18} className="mb-1 text-ink" />
      <button
        type="button"
        onClick={onExpand}
        title="Expand the catalog"
        aria-label="Expand the catalog"
        aria-expanded={false}
        className="flex size-8 items-center justify-center rounded-control text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
      >
        <PanelLeftOpen size={16} aria-hidden />
      </button>
      <span aria-hidden className="my-1 h-px w-6 bg-line" />
      {sections.map(({ key, kind, label }) => (
        <button
          key={key}
          type="button"
          onClick={onExpand}
          title={`${label} — expand the catalog`}
          aria-label={`${label} — expand the catalog`}
          className="flex size-8 items-center justify-center rounded-control t-micro transition-colors hover:bg-surface"
        >
          <KindIcon kind={kind} size={16} />
        </button>
      ))}
      <NavLink
        to={paths.settings()}
        title="Settings"
        aria-label="Settings"
        className={({ isActive }) =>
          `mt-auto flex size-8 items-center justify-center rounded-control t-micro transition-colors hover:bg-surface ${
            isActive ? "bg-surface text-accent" : "text-muted hover:text-ink"
          }`
        }
      >
        <Settings2 size={16} aria-hidden />
      </NavLink>
    </nav>
  );
}

// ---------------------------------------------------------------------------

export function Sidebar({
  railed = false,
  onExpand,
}: {
  /** True once the shell panel has been collapsed to the 48px rail. */
  railed?: boolean;
  onExpand?: () => void;
}) {
  const { query, setQuery, inputRef } = useSearch();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Set<LeafKind>>(new Set());

  // Which bands and which owner groups are folded. Both outlive the session:
  // they are a reader's standing answer to "I do not work on that", unlike the
  // branch state below, which follows whatever is selected.
  const [sections, setSections] = useState<Flags>(() =>
    readFlags(SECTIONS_KEY),
  );
  const [groups, setGroups] = useState<Flags>(() => readFlags(FLOW_GROUPS_KEY));

  const sectionOpen = (key: string): boolean => sections[key] ?? true;
  const toggleSection = (key: string) =>
    setSections((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? true) };
      writeFlags(SECTIONS_KEY, next);
      return next;
    });
  const groupOpen = (key: string): boolean => groups[key] ?? true;
  const toggleGroup = (key: string) =>
    setGroups((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? true) };
      writeFlags(FLOW_GROUPS_KEY, next);
      return next;
    });

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

  const flowGroups = useMemo(
    () =>
      groupFlowsByOwner(
        catalog.flows.filter((f) =>
          matches(query, f.id, f.slug, f.name, f.summary),
        ),
      ),
    [query],
  );
  const flowCount = flowGroups.reduce((n, g) => n + g.entries.length, 0);

  // One row per vocabulary, not per word: thirty-eight terms in the tree would
  // be a dictionary nobody scrolls past to reach the model. The row opens the
  // page already filtered to that context, and the filter box narrows to the
  // contexts that still have a word in them.
  const vocabs = useMemo(
    () =>
      vocabularies(catalog)
        .map((v) => ({ ...v, terms: matchTerms(v.terms, query) }))
        .filter((v) => v.terms.length > 0),
    [query],
  );
  const termCount = vocabs.reduce((n, v) => n + v.terms.length, 0);

  // Core first, then supporting, then generic, then the ones nobody has rated;
  // alphabetical inside each. This is the only ordering classification does.
  const contexts = useMemo(
    () =>
      [...catalog.contexts]
        .sort(
          (a, b) =>
            classificationRank(a.classification) -
              classificationRank(b.classification) ||
            a.name.localeCompare(b.name),
        )
        .map((c) => matchContext(c, query))
        .filter(
          (x): x is { context: BoundedContext; services: ServiceMatch[] } =>
            x !== null,
        ),
    [query],
  );

  // The schema modules, filtered. Nothing at all when the estate has never
  // published a proto, which is what keeps the band from appearing empty.
  const modules = useMemo(
    () =>
      matchModules(allModules(catalog), (...fields) =>
        matches(query, ...fields),
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
    // A store sits behind two closed groups by default, and a table behind
    // three; a row nobody can see is a selection nobody can follow.
    if ("store" in resolved) {
      keys.push(`s:${resolved.service.id}:data`, `st:${resolved.store.id}`);
    }
    // A module has no ancestor to open - it sits at the top of its own band -
    // so only the band itself has to be unfolded for the row to be findable.
    const band = resolved.kind === "module" ? "registry" : "contexts";

    if (keys.length === 0 && band === "contexts") return;

    // The band itself can be folded, and folding it hides every ancestor at
    // once - so the section is opened first, then the branches inside it.
    setSections((prev) => {
      if (prev[band] !== false) return prev;
      const next = { ...prev, [band]: true };
      writeFlags(SECTIONS_KEY, next);
      return next;
    });

    if (keys.length === 0) return;

    setCollapsed((c) => {
      // Only skip when every ancestor is *explicitly* open. An unset key means
      // "still on its default", which for an aggregate is closed.
      if (keys.every((k) => c[k] === true)) return c;
      const next = { ...c };
      for (const k of keys) next[k] = true;
      return next;
    });

    // A kind switched off behind the funnel would swallow the row silently.
    const chip: LeafKind | null =
      resolved.kind === "event"
        ? "event"
        : "store" in resolved
          ? "table"
          : null;
    if (chip) {
      setHidden((prev) => {
        if (!prev.has(chip)) return prev;
        const next = new Set(prev);
        next.delete(chip);
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
  }, [selection, collapsed, hidden, sections, groups]);

  if (railed) return <IconRail onExpand={() => onExpand?.()} />;

  const resetKinds = () => setHidden(new Set());

  return (
    <nav
      className="flex h-full flex-col border-r border-line bg-canvas"
      aria-label="Catalog"
    >
      {/* Two rows, and only two: the mark and the name, then the filter box
          with the funnel beside it. Everything the funnel holds used to live
          here as a third and fourth row, in the one pane that is always on
          screen. */}
      <div className="shrink-0 border-b px-3 pt-2.5 pb-2 border-line">
        <Wordmark />
        <div className="mt-2 flex items-center gap-2">
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
            className="mono h-8 min-w-0 flex-1 rounded-control border bg-transparent px-2 outline-none placeholder:text-muted border-line t-micro transition-colors hover:border-line-strong"
            aria-label="Filter catalog"
          />
          <KindFilter
            hidden={hidden}
            onToggle={toggleKind}
            onReset={resetKinds}
          />
        </div>
        <HidingLine hidden={hidden} onReset={resetKinds} />
      </div>

      <div
        ref={scrollerRef}
        data-nav-list
        className="pane flex-1 overflow-y-auto pb-3"
      >
        <PinnedSection
          open={sectionOpen("pinned")}
          onToggle={() => toggleSection("pinned")}
        />

        <Section
          title="Flows"
          count={flowCount}
          open={filtering || sectionOpen("flows")}
          onToggle={() => toggleSection("flows")}
        >
          {flowGroups.length === 0 ? (
            <TreeNote>{filtering ? "no match" : "none charted yet"}</TreeNote>
          ) : null}
          {flowGroups.map((group) => {
            const key = group.owner ?? "unowned";
            return (
              <FlowGroupNode
                key={key}
                group={group}
                open={filtering || groupOpen(key)}
                onToggle={() => toggleGroup(key)}
              />
            );
          })}
        </Section>

        <Section
          title="Contexts"
          count={contexts.length}
          open={filtering || sectionOpen("contexts")}
          onToggle={() => toggleSection("contexts")}
        >
          {contexts.length === 0 ? (
            <TreeNote>
              {filtering ? "no match" : "nothing extracted yet"}
            </TreeNote>
          ) : null}
          {contexts.map(({ context, services }) => {
            const ckey = `c:${context.id}`;
            const copen = filtering || isOpen(ckey, true);
            const unresolved = contextStats(context).unresolved;
            return (
              <div key={context.id}>
                <Branch
                  to={paths.context(context.id)}
                  depth={0}
                  open={copen}
                  onToggle={() => toggle(ckey, true)}
                  label={`context ${context.id}`}
                  selId={context.id}
                  end={
                    <>
                      {/* Its own target, because it goes somewhere else: the
                          reader clicked the count, and the count is a list. */}
                      {unresolved > 0 ? (
                        <Link
                          to={`${paths.problems()}?context=${encodeURIComponent(context.id)}`}
                          title={`${unresolved} unresolved ${plural(unresolved, "edge")} — open Problems`}
                          className="mono tnum flex shrink-0 items-center px-1.5 text-unresolved hover:underline"
                        >
                          {unresolved}
                        </Link>
                      ) : null}
                      <span className="ml-auto" />
                      {/* Only worth saying while the services are not on
                          screen; once the branch is open the reader can count
                          them. */}
                      {!copen ? (
                        <span className="mono flex shrink-0 items-center pr-1.5 text-muted opacity-0 t-micro transition-opacity group-hover:opacity-100">
                          {context.services.length}{" "}
                          {plural(context.services.length, "service")}
                        </span>
                      ) : null}
                    </>
                  }
                  right={
                    context.classification ? (
                      <span
                        className="sb-class"
                        title={CLASSIFICATION_NOTE[context.classification]}
                      >
                        {context.classification}
                      </span>
                    ) : null
                  }
                >
                  <KindIcon kind="context" contextId={context.id} />
                  <span className="truncate" title={context.id}>
                    {context.name}
                  </span>
                </Branch>
                {copen
                  ? services.map(
                      ({ service, aggregates, endpoints, stores }) => {
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
                              <span className="truncate" title={service.id}>
                                {service.name}
                              </span>
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
                            {/* Between the model and where it is kept: an
                              endpoint is how the outside reaches the first and
                              eventually moves the second. Methods are listed
                              flat rather than nested under their interface -
                              an operationId is unique across a document, so
                              the extra level would carry no information and
                              cost a line of indent in a narrow tree. */}
                            {sopen &&
                            shows("endpoint") &&
                            endpoints.length > 0 ? (
                              <Group
                                kind="endpoint"
                                label="api"
                                count={endpoints.reduce(
                                  (n, e) => n + e.methods.length,
                                  0,
                                )}
                                depth={2}
                                open={filtering || isOpen(`${skey}:api`, false)}
                                onToggle={() => toggle(`${skey}:api`, false)}
                              >
                                {endpoints.flatMap(({ provided, methods }) =>
                                  methods.map((method) => (
                                    <Leaf
                                      key={`${provided.id}/${method.name}`}
                                      to={`${paths.service(context.id, service.slug)}?tab=provides`}
                                      depth={3}
                                      title={`${provided.id}/${method.name} — ${provided.source}`}
                                    >
                                      <KindIcon kind="endpoint" />
                                      <span className="mono truncate">
                                        {method.name}
                                      </span>
                                    </Leaf>
                                  )),
                                )}
                              </Group>
                            ) : null}

                            {/* After the aggregates, because the model comes
                              before where it is kept. Closed by default: this
                              is the answer to a question about deployment, not
                              the one the tree is usually open for. */}
                            {sopen && shows("table") ? (
                              <Group
                                kind="table"
                                label="data"
                                count={stores.length}
                                depth={2}
                                open={
                                  filtering || isOpen(`${skey}:data`, false)
                                }
                                onToggle={() => toggle(`${skey}:data`, false)}
                              >
                                {stores.map(({ store, tables, views }) => (
                                  <StoreNode
                                    key={store.id}
                                    store={store}
                                    tables={tables}
                                    views={shows("view") ? views : []}
                                    contextId={context.id}
                                    serviceSlug={service.slug}
                                    filtering={filtering}
                                    isOpen={isOpen}
                                    toggle={toggle}
                                  />
                                ))}
                              </Group>
                            ) : null}
                          </div>
                        );
                      },
                    )
                  : null}
              </div>
            );
          })}
        </Section>

        {/* Guarded on the count rather than drawn empty: `Section` renders its
            header and a TreeNote at zero, so an estate that has never published
            a proto would grow a permanent dead row. */}
        {modules.length > 0 ? (
          <Section
            title="Registry"
            count={modules.length}
            open={filtering || sectionOpen("registry")}
            onToggle={() => toggleSection("registry")}
          >
            {modules.map(({ module, packages }) => {
              const open = filtering || isOpen(`mod:${module.id}`, false);

              return (
                <div key={module.id}>
                  <Branch
                    to={paths.module(module.slug)}
                    depth={0}
                    selId={module.id}
                    label={`module ${module.name}`}
                    open={open}
                    onToggle={() => toggle(`mod:${module.id}`, false)}
                    right={
                      module.commit ? null : (
                        <span
                          className="mono text-muted"
                          title="tracked by label rather than pinned to a commit"
                        >
                          ~
                        </span>
                      )
                    }
                  >
                    <KindIcon kind="module" />
                    <span className="mono truncate" title={module.id}>
                      {module.name}
                    </span>
                  </Branch>

                  {/* Two levels only. The interfaces inside a module are
                      already in the tree under the service that answers on
                      them, and listing them again would say the estate has
                      twice as many. */}
                  {open
                    ? packages.map((name) => (
                        <Leaf
                          key={name}
                          to={`${paths.module(module.slug)}?tab=interfaces#${packageAnchor(name)}`}
                          depth={1}
                          title={`${name} — ${module.id}`}
                        >
                          <KindIcon kind="endpoint" />
                          <span className="mono truncate">{name}</span>
                        </Leaf>
                      ))
                    : null}
                </div>
              );
            })}
            <NavLink
              to={paths.registry()}
              data-nav-item
              className="tree-row mono flex items-center py-[3px] pr-2 pl-[8px] text-accent hover:bg-surface"
            >
              view all {allModules(catalog).length} →
            </NavLink>
          </Section>
        ) : null}

        <Section
          title="Decisions"
          count={adrs.length}
          open={filtering || sectionOpen("decisions")}
          onToggle={() => toggleSection("decisions")}
        >
          {adrs.length === 0 ? (
            <TreeNote>
              {filtering ? "no match" : "nothing on the record yet"}
            </TreeNote>
          ) : null}
          {adrs.map((adr) => (
            <Leaf
              key={adr.id}
              to={paths.adr(adr.slug)}
              depth={0}
              title={`${adr.id} — ${adr.title}`}
            >
              <KindIcon kind="adr" />
              {/* The number without its prefix: the header already said
                  DECISIONS, and "ADR-" repeated down a column is a word the
                  reader reads five times to get to the digits. */}
              <span
                className={`mono tnum shrink-0 ${isStruck(adr.status) ? "line-through text-muted" : ""}`}
              >
                {adrNumber(adr).replace(/^ADR-/, "")}
              </span>
              <span className="truncate">{adr.title}</span>
            </Leaf>
          ))}
          {catalog.adrs.length > 0 ? (
            <NavLink
              to={paths.adrs()}
              data-nav-item
              className="tree-row mono flex items-center py-[3px] pr-2 pl-[8px] text-accent hover:bg-surface"
            >
              view all {catalog.adrs.length} →
            </NavLink>
          ) : null}
        </Section>

        {/* Guarded on the count, like Registry: an estate that has written no
            glossary would otherwise grow a permanent empty band teaching a
            feature by taking up room. */}
        {allTerms(catalog).length > 0 ? (
          <Section
            title="Language"
            count={termCount}
            open={filtering || sectionOpen("language")}
            onToggle={() => toggleSection("language")}
          >
            {vocabs.length === 0 ? <TreeNote>no match</TreeNote> : null}
            {vocabs.map((vocabulary) => (
              <Leaf
                key={vocabulary.contextId}
                to={paths.contextLanguage(vocabulary.contextId)}
                depth={0}
                title={`${vocabulary.context?.name ?? vocabulary.contextId} — one meaning per word inside this context`}
              >
                <KindIcon kind="context" contextId={vocabulary.contextId} />
                <span className="truncate">{vocabulary.contextId}</span>
                <span className="sb-count">{vocabulary.terms.length}</span>
              </Leaf>
            ))}
            <NavLink
              to={paths.language()}
              data-nav-item
              className="tree-row mono flex items-center py-[3px] pr-2 pl-[8px] text-accent hover:bg-surface"
            >
              view all {allTerms(catalog).length} →
            </NavLink>
          </Section>
        ) : null}
      </div>

      <BottomGroup />
    </nav>
  );
}

/**
 * A store and the tables in it. The store row navigates to its own ER page; the
 * table rows land on that page with the table already selected, because a table
 * read outside the picture of what points at it is a list of column names.
 */
function StoreNode({
  store,
  tables,
  views,
  contextId,
  serviceSlug,
  filtering,
  isOpen,
  toggle,
}: {
  store: Store;
  tables: Table[];
  views: View[];
  contextId: string;
  serviceSlug: string;
  filtering: boolean;
  isOpen: (key: string, def: boolean) => boolean;
  toggle: (key: string, def: boolean) => void;
}) {
  const key = `st:${store.id}`;
  const open = filtering || isOpen(key, false);
  const to = paths.store(contextId, serviceSlug, store.slug);

  return (
    <div>
      <Branch
        to={to}
        depth={3}
        open={open}
        onToggle={() => toggle(key, false)}
        label={`store ${store.id}`}
        selId={store.id}
        right={
          <span
            className="mono text-muted"
            title={STORE_KIND_LABEL[store.kind]}
          >
            {store.kind}
          </span>
        }
      >
        <KindIcon kind="store" />
        <span className="truncate" title={store.id}>
          {store.name}
        </span>
      </Branch>
      {/* Tables and views keep the monospace: unlike everything above them
          they are not human names but the identifiers a migration writes and a
          query names, and reading one in prose type invites a typo. */}
      {open
        ? tables.map((table) => (
            <Leaf
              key={table.id}
              to={`${to}${selectionHash({ kind: "table", id: table.id })}`}
              depth={4}
              title={table.doc ?? table.id}
              selId={table.id}
            >
              <KindIcon kind="table" />
              <span className="mono truncate">{table.name}</span>
              {table.role && table.role !== "other" ? (
                <span className="mono ml-auto shrink-0 text-muted">
                  {table.role === "aggregate-root" ? "root" : table.role}
                </span>
              ) : null}
            </Leaf>
          ))
        : null}
      {/* Views after the tables, always: they are computed from them, and a
          tree that interleaved the two would put a reading of the rows above
          the place the rows live. */}
      {open
        ? views.map((view) => (
            <Leaf
              key={view.id}
              to={`${to}${selectionHash({ kind: "view", id: view.id })}`}
              depth={4}
              title={view.doc ?? view.id}
              selId={view.id}
            >
              <KindIcon kind="view" />
              <span className="mono truncate">{view.name}</span>
              <span className="mono ml-auto shrink-0 text-muted">
                {view.materialized ? "matview" : "view"}
              </span>
            </Leaf>
          ))
        : null}
    </div>
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
      <Leaf key={block.id} to={path} depth={4} title={block.doc ?? block.id}>
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
        <span className="truncate font-medium" title={aggregate.id}>
          {aggregate.name}
        </span>
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
                    title={event.id}
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
                <Leaf
                  key={op.id}
                  to={`${to}#bb-commands`}
                  depth={4}
                  title={op.id}
                >
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
                <Leaf
                  key={op.id}
                  to={`${to}#bb-queries`}
                  depth={4}
                  title={op.id}
                >
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
