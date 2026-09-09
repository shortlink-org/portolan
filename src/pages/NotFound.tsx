import type { PointerEvent as ReactPointerEvent } from "react";
import { House, Search } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useDocumentTitle } from "../app/title";

/**
 * Both shapes of "not here" end the same way: the one control that finds a
 * thing by its current name. A reader who followed a stale link has a name in
 * mind, and the palette is where that name still works.
 */
function SearchHint() {
  return (
    <p className="mono mt-3 text-muted">
      <kbd>⌘K</kbd> searches the whole catalog
    </p>
  );
}

export function NotFound({ kind, id }: { kind: string; id?: string }) {
  useDocumentTitle(`${kind} not found`);
  return (
    <div className="glow p-gutter">
      <h1 className="text-lg font-semibold">{kind} not found</h1>
      <p className="mt-3 text-muted">
        nothing in the catalog answers to “{id ?? ""}” — it may have been
        renamed since this chart was drawn
      </p>
      <SearchHint />
      <Link
        to="/"
        className="mono mt-6 inline-block rounded-control text-accent hover:underline"
      >
        ← overview
      </Link>
    </div>
  );
}

function moveArtwork(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  event.currentTarget.style.setProperty("--parallax-x", x.toFixed(3));
  event.currentTarget.style.setProperty("--parallax-y", y.toFixed(3));
}

function resetArtwork(event: ReactPointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty("--parallax-x", "0");
  event.currentTarget.style.setProperty("--parallax-y", "0");
}

function LostExplorer() {
  return (
    <div
      className="not-found-art"
      onPointerMove={moveArtwork}
      onPointerLeave={resetArtwork}
    >
      <div className="not-found-art-grid" aria-hidden />
      <span className="not-found-number mono" aria-hidden>
        404
      </span>
      <div className="not-found-cat-layer">
        <img
          src={`${import.meta.env.BASE_URL}404-cat-v1.webp`}
          alt="An explorer cat studying a folded map with a missing route"
          className="not-found-cat"
          draggable={false}
        />
      </div>
    </div>
  );
}

export function NotFoundPage({ onOpenSearch }: { onOpenSearch: () => void }) {
  useDocumentTitle("Route not found");
  const { pathname } = useLocation();

  return (
    <div className="not-found-page pane">
      <section className="not-found-state" aria-labelledby="not-found-title">
        <LostExplorer />

        <div className="not-found-copy">
          <p className="label text-accent">uncharted route</p>
          <h1 id="not-found-title" className="mt-2 text-xl font-semibold">
            Route not found
          </h1>
          <p className="mt-3 text-muted">
            This path runs beyond the current catalog. It may have moved or
            been renamed since the chart was drawn.
          </p>

          <div className="not-found-request mt-5">
            <span className="mono text-faint">requested</span>
            <code className="mono trunc text-ink" title={pathname}>
              {pathname}
            </code>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="product-primary"
              onClick={onOpenSearch}
              aria-keyshortcuts="Meta+K Control+K"
            >
              <Search size={15} aria-hidden />
              <span>Search catalog</span>
              <kbd className="not-found-key">⌘K</kbd>
            </button>
            <Link to="/" className="tbtn py-1.5 text-ink">
              <House size={15} aria-hidden />
              Back to overview
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
