import type React from "react";
import { ChevronRight } from "lucide-react";
import { NavLink, useLocation, useMatch } from "react-router";

import { KindIcon } from "../components/kind";
import type { LeafKind } from "../lib/kinds";
import { m, transitions, Unfold } from "../lib/motion";
import { selectionHash } from "../selection/hash";
import { selectionFor } from "../selection/model";
import { selectsInPlace } from "../selection/pages";
import { useSelectionStore } from "../selection/store";

export const indent = (depth: number) => 8 + depth * 12;

/**
 * The selection's light: the raised background and the accent edge of the
 * row that is selected. One element for the whole tree - a new selection is
 * the same light arriving on another row, and it travels there on the settle
 * spring rather than going out here and coming on over there. `-left-0.5`
 * puts its edge over the row's own transparent 2px border, so the text does
 * not move.
 */
function SelectionLight() {
  return (
    <m.span
      layoutId="selection"
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 -left-0.5 -z-10 border-l-2 border-accent"
      style={{ background: "var(--surface-2)" }}
      transition={transitions.settle}
    />
  );
}
export function Chevron({ open }: { open: boolean }) {
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
 * Clicking an unselected row selects it. Whether it also navigates is the
 * question the page on screen answers: on a flow page, picking something that
 * flow already draws is a question about that sequence, so the reader stays
 * put. Clicking the highlighted row again follows its link to its own page.
 *
 * Only the in-place case writes the store here. A row that navigates carries
 * its selection in the link's hash instead (see `rowTarget`): writing the
 * store first and then letting the link go would race SelectionSync, whose
 * `replace` lands with the pathname it rendered with - the page being left -
 * and undoes the navigation. A selection in the URL wins on arrival, so one
 * write does both jobs. The palette works the same way.
 */
function useRowClick(selId: string | undefined) {
  const select = useSelectionStore((s) => s.select);
  const { pathname } = useLocation();
  return (e: React.MouseEvent) => {
    if (selId === undefined) return;
    const selection = selectionFor(selId);
    const current = useSelectionStore.getState().selection;
    if (!selectsInPlace(pathname, selection, current)) return;
    e.preventDefault();
    select(selId, "sidebar");
  };
}

/** Where a row's link goes: its page, with the row's selection in the hash. */
function rowTarget(to: string, selId: string | undefined): string {
  if (selId === undefined || to.includes("#")) return to;
  return `${to}${selectionHash(selectionFor(selId))}`;
}

/**
 * A leaf: the whole row navigates. Rows that stand for a selectable entity also
 * carry `selId`, which makes them both a writer of the selection and a reader
 * of it - the row lights up whether it was clicked here, on a diagram, or in
 * the palette.
 */
export function Leaf({
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
      to={rowTarget(to, selId)}
      end
      title={title}
      data-sel={selId}
      data-tree-row
      data-tree-depth={depth}
      onClick={onClick}
      style={({ isActive }) => ({
        paddingLeft: indent(depth),
        background: isActive && !selected ? "var(--surface-2)" : undefined,
        borderLeftWidth: 2,
        borderLeftStyle: "solid",
        borderLeftColor:
          isActive && !selected ? "var(--accent)" : "transparent",
      })}
      /* The edge is always 2px, transparent when idle: lighting a row must not
         shift the text beside it. The route's own row paints its light in
         place; the SELECTION's light is one element that slides from the row
         it was on to this one. */
      data-nav-item
      className="tree-row relative isolate flex items-center gap-1.5 py-[3px] pr-2 t-micro transition-colors hover:bg-surface"
    >
      {selected ? <SelectionLight /> : null}
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
export function Branch({
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
  const active = useMatch({ path: to, end: true }) !== null && !selected;
  return (
    <>
      <div
        className="tree-row group relative isolate flex items-stretch t-micro transition-colors hover:bg-surface"
        style={{
          paddingLeft: indent(depth),
          background: active ? "var(--surface-2)" : undefined,
          borderLeftWidth: 2,
          borderLeftStyle: "solid",
          borderLeftColor: active ? "var(--accent)" : "transparent",
        }}
      >
        {selected ? <SelectionLight /> : null}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          data-tree-toggle
          className="flex shrink-0 items-center pr-1"
        >
          <Chevron open={open} />
        </button>
        <NavLink
          to={rowTarget(to, selId)}
          end
          data-sel={selId}
          data-nav-item
          data-tree-row
          data-tree-depth={depth}
          data-tree-open={open}
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
export function Group({
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
        data-tree-row
        data-tree-depth={depth}
        data-tree-open={open}
        style={{ paddingLeft: indent(depth) }}
        className="tree-row group-row"
      >
        <Chevron open={open} />
        <KindIcon kind={kind} />
        <span>
          {label ?? KIND_GROUP_LABEL[kind]} ({count})
        </span>
      </button>
      <Unfold open={open}>{children}</Unfold>
    </>
  );
}

const KIND_GROUP_LABEL: Record<LeafKind, string> = {
  vo: "value objects",
  entity: "entities",
  enum: "enums",
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
export function Section({
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
  /** The first section needs no air above it - the header is already there. */
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
      <Unfold open={open}>{children}</Unfold>
    </div>
  );
}
