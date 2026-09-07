import { Link } from "react-router";
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

export function NotFoundPage() {
  useDocumentTitle("Not found");
  return (
    <div className="glow p-gutter">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-3 text-muted">
        off the edge of the chart — no route runs through here
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
