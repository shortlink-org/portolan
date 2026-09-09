import { useMemo, useRef, useState } from "react";
import { GripVertical, PinOff, TriangleAlert } from "lucide-react";
import { NavLink } from "react-router";

import { KindIcon } from "../components/kind";
import { contextName, ctxStyle } from "../lib/context-color";
import {
  FLOW_HEALTH_NOTE,
  reachDots,
  visibleEntries,
} from "../lib/flow-tree";
import type { FlowEntry, FlowHealth, FlowGroup } from "../lib/flow-tree";
import { Unfold } from "../lib/motion";
import { paths } from "../routes";
import { resolvePin, usePinsStore } from "./pins";
import { Chevron, Leaf, Section, indent } from "./SidebarTree";

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
export function FlowGroupNode({
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
      <Unfold open={open}>
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
      </Unfold>
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
export function PinnedSection({
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
