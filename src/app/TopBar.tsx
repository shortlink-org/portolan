import { Link } from "react-router";
import { Moon, Network, Search, Sun } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { BuildStamp } from "./BuildStamp";
import { useTheme } from "./theme";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b px-gutter border-line bg-canvas">
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

        {/* One border around the pair, a hairline between them: two controls,
            one object. */}
        <div className="seg">
          <Link to="/graph" className="flex items-center gap-1.5">
            <Network size={16} aria-hidden />
            graph
          </Link>
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
