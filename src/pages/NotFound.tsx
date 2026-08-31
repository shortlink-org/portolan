import { Link } from "react-router";

export function NotFound({ kind, id }: { kind: string; id?: string }) {
  return (
    <div className="glow p-gutter">
      <h1 className="text-lg font-semibold">{kind} not found</h1>
      <p className="mono mt-3 text-muted">
        nothing in the catalog matches “{id ?? ""}”
      </p>
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
  return (
    <div className="glow p-gutter">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mono mt-3 text-muted">no route matches this URL</p>
      <Link
        to="/flows"
        className="mono mt-6 inline-block rounded-control text-accent hover:underline"
      >
        ← flows
      </Link>
    </div>
  );
}
