import { useMemo } from "react";
import { NavLink } from "react-router";
import {
  Check,
  PanelLeftOpen,
  Settings2,
  TriangleAlert,
} from "lucide-react";

import { allModules } from "../catalog";
import { KindIcon } from "../components/kind";
import { CompassRose } from "../components/logo";
import { catalog, index } from "../data";
import { allProblems } from "../lib/all-problems";
import type { Kind } from "../lib/kinds";
import { paths } from "../routes";

const indent = (depth: number) => 8 + depth * 12;

// ---------------------------------------------------------------------------
// The bottom group. A sibling of the scroller rather than a row inside it, so
// "pinned to the bottom" is a fact about the layout and not about how far the
// tree happens to have been scrolled.
// ---------------------------------------------------------------------------

export function SidebarBottomGroup() {
  // The same complete list as the Problems page, because that is what the row
  // opens. The badge is red while anything on it is an error and amber when
  // only the schema disagrees with itself - a page of warnings is not a clean
  // estate, and a green tick over it would be the one lie the row can tell.
  const found = useMemo(() => allProblems(catalog, index), []);
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
export function SidebarIconRail({ onExpand }: { onExpand: () => void }) {
  const sections: { key: string; kind: Kind; label: string }[] = [
    { key: "flows", kind: "flow", label: "Flows" },
    { key: "domains", kind: "context", label: "Contexts" },
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
