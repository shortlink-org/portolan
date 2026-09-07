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
import { paths } from "../routes";
import { ContextPill } from "../components/primitives";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { ErCanvas } from "../er/ErCanvas";
import { StoreHeader } from "../er/StoreHeader";
import { RedisSchema } from "../er/RedisSchema";
import { storeColumnCount, storeViewCount } from "../lib/data-model";
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
  const views = storeViewCount(store);
  const keyspaces = store.keyspaces ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        kind={
          <>
            store ·{" "}
            <Link
              to={paths.service(context.id, service.slug)}
              className="rounded-control hover:text-ink hover:underline"
            >
              {service.id}
            </Link>
          </>
        }
        name={store.name}
        id={store.id}
        contextId={context.id}
        pin={{ kind: "store", id: store.id }}
        right={<ContextPill id={context.id} name={context.name} />}
      >
        <div className="mt-3 max-w-table">
          <StoreHeader store={store} access="owns" linked={false} />
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-x-3 text-muted">
          <span>
            {keyspaces.length > 0 ? (
              <>
                <span className="tnum">{keyspaces.length}</span>{" "}
                {plural(keyspaces.length, "key pattern")}
              </>
            ) : (
              <>
                <span className="tnum">{store.tables.length}</span>{" "}
                {plural(store.tables.length, "table")} ·{" "}
                <span className="tnum">{columns}</span>{" "}
                {plural(columns, "column")}
              </>
            )}
            {/* Views are counted apart from the tables rather than added to
                them: they hold no rows, and one number for both would answer
                "how much is stored here" with the wrong figure. */}
            {keyspaces.length === 0 && views > 0 ? (
              <>
                {" · "}
                <span className="tnum">{views}</span> {plural(views, "view")}
              </>
            ) : null}
          </span>
        </div>
        {/* Who depends on this schema: the services that read it, and the
            aggregates its tables hold. A line rather than a section, because
            the canvas below takes the whole pane. */}
        <WhatLinksHere
          variant="line"
          target={{ kind: "store", id: store.id }}
        />
      </PageHeader>

      {/* The canvas takes the rest of the pane rather than a fixed height: on
          this page the schema IS the content, so it gets the room. */}
      <div className="min-h-0 flex-1 overflow-auto p-gutter">
        {keyspaces.length > 0 ? (
          <RedisSchema store={store} />
        ) : (
          <ErCanvas store={store} height="100%" />
        )}
      </div>
    </div>
  );
}
