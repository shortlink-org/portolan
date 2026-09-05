import { Link } from "react-router";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import {
  Keyboard,
  Map,
  Menu,
  MoreHorizontal,
  Moon,
  Network,
  Rows2,
  Rows4,
  Search,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { BuildStamp } from "./BuildStamp";
import { useDensity } from "./density";
import { usePhone } from "./responsive";
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
  const phone = usePhone();

  return (
    /* One row while there is room for one, and rows when there is not: the
       shell degrades to a drawer at the narrow breakpoint, but the bar's own
       contents have a width of their own and run out before that. Wrapping is
       what keeps every control reachable - hiding them would take the theme
       and the shortcuts sheet away from exactly the window that has the least
       room to do without them.

       On a phone wrapping is no longer the lesser evil: the bar wrapped to
       three rows of chrome above a page that had few enough of its own, and
       chrome that tall is not "reachable", it is in the way. So below the
       phone breakpoint the bar keeps one row and folds instead - the search
       box to its icon, the whole-estate views and the two settings into an
       overflow menu, the build stamp into a popover. What stays on the row is
       what a reader steers with: the drawer, where they are, and search. */
    <header
      className={`flex min-h-12 shrink-0 items-center border-b py-1 px-gutter border-line bg-canvas ${
        phone ? "gap-x-2" : "flex-wrap gap-x-4 gap-y-2"
      }`}
    >
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

      <div
        className={`ml-auto flex shrink-0 items-center justify-end ${
          phone ? "gap-1" : "flex-wrap gap-3"
        }`}
      >
        {/* Opens the palette rather than filtering in place: the sidebar box
            narrows the tree, this one searches the whole catalog. */}
        {phone ? (
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label="Search catalog"
            aria-keyshortcuts="Meta+K Control+K"
            title="Search catalog"
            className="flex size-8 shrink-0 items-center justify-center rounded-control border border-line text-muted t-micro transition-colors hover:bg-surface hover:border-line-strong hover:text-ink"
          >
            <Search size={16} aria-hidden />
          </button>
        ) : (
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
        )}

        {phone ? (
          <OverflowMenu onOpenHelp={onOpenHelp} />
        ) : (
          /* One border around the set, hairlines between them: four controls,
             one object. */
          <Wide onOpenHelp={onOpenHelp} />
        )}

        <BuildStamp compact={phone} />
      </div>
    </header>
  );
}

function Wide({ onOpenHelp }: { onOpenHelp: () => void }) {
  const { theme, toggle } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  const compact = density === "compact";

  return (
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
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
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
  );
}

const ROW =
  "mono flex w-full items-center gap-2 rounded-control px-2 py-2 text-left text-muted transition-colors hover:bg-surface hover:text-ink";

/**
 * Everything the wide bar puts on the row and a phone has no room for. It is a
 * menu rather than a smaller segmented control because at this width the
 * controls had shed their labels first, and five unlabelled icons in a strip is
 * a puzzle - the menu buys the labels back with the space it saves.
 */
function OverflowMenu({ onOpenHelp }: { onOpenHelp: () => void }) {
  const { theme, toggle } = useTheme();
  const { density, toggle: toggleDensity } = useDensity();
  const compact = density === "compact";

  return (
    <Popover className="shrink-0">
      <PopoverButton
        aria-label="More"
        title="More"
        className={({ open }) =>
          `flex size-8 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${
            open ? "text-accent" : "text-muted hover:text-ink"
          }`
        }
      >
        <MoreHorizontal size={16} aria-hidden />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 w-56 rounded-control border bg-canvas p-1 border-line-strong shadow-md focus:outline-none"
      >
        {({ close }) => (
          <>
            <div className="label mt-1 mb-1 px-2">the whole estate</div>
            <Link to="/map" onClick={() => close()} className={ROW}>
              <Map size={16} aria-hidden className="shrink-0" />
              context map
            </Link>
            <Link to="/graph" onClick={() => close()} className={ROW}>
              <Network size={16} aria-hidden className="shrink-0" />
              dependency graph
            </Link>

            <div className="label mt-2 mb-1 px-2">how portolan is set</div>
            <MenuButton
              icon={compact ? Rows2 : Rows4}
              onClick={() => {
                toggleDensity();
                close();
              }}
            >
              {compact ? "comfortable rows" : "compact rows"}
            </MenuButton>
            <MenuButton
              icon={theme === "dark" ? Sun : Moon}
              onClick={() => {
                toggle();
                close();
              }}
            >
              {theme === "dark" ? "light theme" : "dark theme"}
            </MenuButton>
            <MenuButton
              icon={Keyboard}
              onClick={() => {
                onOpenHelp();
                close();
              }}
            >
              keyboard shortcuts
            </MenuButton>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

/** A row of the menu that does something rather than going somewhere. */
function MenuButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW}>
      <Icon size={16} aria-hidden className="shrink-0" />
      {children}
    </button>
  );
}
