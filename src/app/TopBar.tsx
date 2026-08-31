import { Link } from "react-router";
import {
  Keyboard,
  Map,
  Menu,
  Moon,
  Network,
  Rows2,
  Rows4,
  Search,
  Sun,
} from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { BuildStamp } from "./BuildStamp";
import { useDensity } from "./density";
import { useTheme } from "./theme";

export function TopBar({
  onOpenPalette,
  onOpenHelp,
  onToggleSidebar,
  narrow = false,
}: {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
  onToggleSidebar: () => void;
  /** Below the narrow breakpoint the tree is a drawer, opened from here. */
  narrow?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  const compact = density === "compact";

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b px-gutter border-line bg-canvas">
      {narrow ? (
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open the catalog"
          aria-keyshortcuts="["
          title="Catalog — ["
          className="-ml-2 flex size-8 shrink-0 items-center justify-center rounded-control text-muted t-micro transition-colors hover:bg-surface hover:text-ink"
        >
          <Menu size={16} aria-hidden />
        </button>
      ) : null}

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-3">
        {/* Opens the palette rather than filtering in place: the sidebar box
            narrows the tree, this one searches the whole catalog. */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search catalog"
          aria-keyshortcuts="Meta+K Control+K"
          className="mono flex w-56 items-center gap-2 rounded-control border px-2 py-1.5 border-line text-muted t-micro transition-colors hover:bg-surface hover:border-line-strong"
        >
          <Search size={16} aria-hidden className="shrink-0" />
          search
          <span className="ml-auto rounded-[4px] border px-1 border-line">
            ⌘K
          </span>
        </button>

        {/* One border around the set, hairlines between them: four controls,
            one object. */}
        <div className="seg">
          {/* The two whole-estate views, side by side: the map is the domains
              and what stands between them, the graph is the services and what
              runs between them. */}
          <Link
            to="/map"
            className="flex items-center gap-1.5"
            aria-keyshortcuts="g m"
            title="Context map — g m"
          >
            <Map size={16} aria-hidden />
            map
          </Link>
          <Link
            to="/graph"
            className="flex items-center gap-1.5"
            title="Dependency graph"
          >
            <Network size={16} aria-hidden />
            graph
          </Link>
          {/* Density is a property of the whole app, so it lives beside the
              theme: both are "how portolan is set", not "what is on screen". */}
          <button
            type="button"
            onClick={toggleDensity}
            aria-pressed={compact}
            aria-label={
              compact ? "Switch to comfortable rows" : "Switch to compact rows"
            }
            title={compact ? "Comfortable rows" : "Compact rows"}
            className="flex items-center"
          >
            {compact ? (
              <Rows2 size={16} aria-hidden />
            ) : (
              <Rows4 size={16} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
            title="Keyboard shortcuts — ?"
            className="flex items-center"
          >
            <Keyboard size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={
              theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            className="flex items-center"
          >
            {theme === "dark" ? (
              <Sun size={16} aria-hidden />
            ) : (
              <Moon size={16} aria-hidden />
            )}
          </button>
        </div>

        <BuildStamp />
      </div>
    </header>
  );
}
