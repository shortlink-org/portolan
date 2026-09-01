// One store, full page.
//
// The service's Data tab shows every store this service touches, stacked and
// short. This is the other half of that: one schema, the whole pane, and the
// detail panel on the right wired to whatever is clicked. A schema of thirty
// tables is not readable in a 340px strip, and a reader who followed a table
// link came here to read exactly one.

import { Link, useParams } from "react-router";
import { catalog } from "../data";
import { PageHeader } from "../components/PageHeader";
import { servicePath } from "../routes";
import { ContextPill } from "../components/primitives";
import { ErCanvas } from "../er/ErCanvas";
import { StoreHeader } from "../er/StoreHeader";
import { readersOfStore, storeColumnCount } from "../lib/data-model";
import { plural } from "../lib/format";
import { NotFound } from "./NotFound";

export function StorePage() {
  const {
    context: contextId,
    service: serviceSlug,
    store: storeSlug,
  } = useParams();

  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);
  const store = service
    ? (catalog.stores ?? []).find(
        (s) => s.slug === storeSlug && s.owner === service.id,
      )
    : undefined;

  if (!context || !service || !store) {
    return <NotFound kind="Store" id={storeSlug} />;
  }

  const columns = storeColumnCount(store);
  const readers = readersOfStore(catalog, store.id, store.owner);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        kind="store"
        name={store.name}
        id={store.id}
        contextId={context.id}
        right={<ContextPill id={context.id} name={context.name} />}
      >
        <div className="mt-3 max-w-table">
          <StoreHeader store={store} access="owns" linked={false} />
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-x-3 text-muted">
          <span>
            <span className="tnum">{store.tables.length}</span>{" "}
            {plural(store.tables.length, "table")} ·{" "}
            <span className="tnum">{columns}</span> {plural(columns, "column")}
          </span>
          {/* Who else reads this schema. Not a warning — reading someone
              else's store is allowed, and it is the writers the Problems page
              objects to — but it is what makes a column rename expensive. */}
          {readers.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-2">
              <span aria-hidden>·</span>
              read by
              {readers.map((reader) => {
                const to = servicePath(reader.id);
                return to ? (
                  <Link
                    key={reader.id}
                    to={to}
                    className="rounded-control text-accent hover:underline"
                  >
                    {reader.id}
                  </Link>
                ) : (
                  <span key={reader.id}>{reader.id}</span>
                );
              })}
            </span>
          ) : null}
        </div>
      </PageHeader>

      {/* The canvas takes the rest of the pane rather than a fixed height: on
          this page the schema IS the content, so it gets the room. */}
      <div className="min-h-0 flex-1 p-gutter">
        <ErCanvas store={store} height="100%" />
      </div>
    </div>
  );
}
