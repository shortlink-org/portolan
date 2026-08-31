import { useEffect, useState } from "react";
import { Link } from "react-router";
import { GitCommitHorizontal, Moon, Network, Search, Sun } from "lucide-react";
import { catalog } from "../data";
import { absoluteTime, relativeTime } from "../lib/format";
import { Breadcrumbs } from "./Breadcrumbs";
import { useTheme } from "./theme";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { theme, toggle } = useTheme();
  const [, force] = useState(0);

  // The build indicator is relative time; nudge it once a minute.
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b px-3 border-line bg-canvas">
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-2">
        {/* Opens the palette rather than filtering in place: the sidebar box
            narrows the tree, this one searches the whole catalog. */}
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search catalog"
          aria-keyshortcuts="Meta+K Control+K"
          className="mono flex w-56 items-center gap-1.5 border px-2 py-1 border-line text-muted hover:bg-surface"
        >
          <Search size={11} aria-hidden />
          search
          <span className="ml-auto border px-1 border-line">⌘K</span>
        </button>

        <Link to="/graph" className="tbtn">
          <Network size={11} aria-hidden />
          graph
        </Link>

        <button
          type="button"
          onClick={toggle}
          aria-label={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          className="tbtn"
        >
          {theme === "dark" ? (
            <Sun size={12} aria-hidden />
          ) : (
            <Moon size={12} aria-hidden />
          )}
        </button>

        <div
          className="mono flex items-center gap-1.5 border px-2 py-1 border-line text-muted"
          title={`generated ${absoluteTime(catalog.generatedAt)} at commit ${catalog.commit}`}
        >
          <GitCommitHorizontal size={11} aria-hidden />
          {catalog.commit}
          <span className="text-line-strong">·</span>
          {relativeTime(catalog.generatedAt)}
        </div>
      </div>
    </header>
  );
}
