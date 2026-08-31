import { Link } from "react-router";

export function NotFound({ kind, id }: { kind: string; id?: string }) {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">{kind} not found</h1>
      <p className="mono mt-2 text-muted">
        nothing in the catalog matches “{id ?? ""}”
      </p>
      <Link to="/" className="mono mt-4 inline-block text-accent">
        ← overview
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mono mt-2 text-muted">no route matches this URL</p>
      <Link to="/flows" className="mono mt-4 inline-block text-accent">
        ← flows
      </Link>
    </div>
  );
}
