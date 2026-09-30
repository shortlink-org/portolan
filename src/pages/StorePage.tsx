// One store, full page.
//
// The service's Data tab shows every store this service touches, stacked and
// short. This is the other half of that: one schema, the whole pane, and the
// detail panel on the right wired to whatever is clicked. A schema of thirty
// tables is not readable in a 340px strip, and a reader who followed a table
// link came here to read exactly one.
//
// A relational store has a second tab: who reads and writes each table. It is
// a tab rather than a section under the canvas because the canvas takes the
// whole pane, and the two answer different questions - what the tables are,
// and who reaches into them.

import { TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import type { CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { catalog } from "../data";
import { walkSteps } from "../catalog";
import { Blank, PageHeader } from "../components/PageHeader";
import { paths } from "../routes";
import { ContextPill } from "../components/primitives";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { ErCanvas } from "../er/ErCanvas";
import { StoreHeader } from "../er/StoreHeader";
import { RedisSchema } from "../er/RedisSchema";
import { StoreAccessMatrix } from "../er/StoreAccessMatrix";
import { TabButton, TabCount, TabRow } from "../components/TabRow";
import { storeColumnCount, storeViewCount } from "../lib/data-model";
import { plural } from "../lib/format";
import { NotFound } from "./NotFound";

export function StorePage() {
  const {
    context: contextId,
    service: serviceSlug,
    store: storeSlug,
  } = useParams();
  const [params, setParams] = useSearchParams();

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
  const unread = keyspaces.length === 0 && store.tables.length === 0;
  // Only tables have per-method accesses to lay out; a Redis store's calls are
  // already on its key cards, and a store with no tables has nothing to cross.
  const tabbed = keyspaces.length === 0 && !unread;
  const tab = tabbed && params.get("tab") === "access" ? "access" : "schema";
  const accessCount = store.tables.reduce(
    (sum, table) => sum + (table.accesses ?? []).length,
    0,
  );
  const usedIn = catalog.flows.flatMap((flow) => {
    const lanes = new Set(
      flow.participants
        .filter((participant) => participant.entityRef === store.id)
        .map((participant) => participant.id),
    );
    return walkSteps(flow.steps).flatMap((step, index) =>
      step.storeAccess?.store === store.id || lanes.has(step.from) || lanes.has(step.to)
        ? [{ flow, step, number: index + 1 }]
        : [],
    );
  });

  const header = (
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
          ) : unread ? (
            "no tables read"
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
      {tabbed ? (
        <div className="mt-4">
          <TabRow active={tab}>
            <TabList className="flex w-max gap-0">
              <TabButton>
                schema<TabCount>{store.tables.length}</TabCount>
              </TabButton>
              <TabButton>
                reads &amp; writes<TabCount>{accessCount}</TabCount>
              </TabButton>
            </TabList>
          </TabRow>
        </div>
      ) : null}
    </PageHeader>
  );

  const schema = (
    <>
      {usedIn.length > 0 ? (
        <section className="mb-section max-w-table" aria-labelledby="used-in-flows">
          <h2 id="used-in-flows" className="label mb-2 text-faint">Used in flows</h2>
          <div className="flex flex-wrap gap-1.5">
            {usedIn.map(({ flow, step, number }) => (
              <Link
                key={`${flow.slug}:${step.id}`}
                to={paths.flowStep(flow.slug, step.id)}
                className="chip border-line-strong hover:border-accent hover:text-accent"
                title={`${flow.name}, step ${number}${step.storeAccess?.method ? ` · ${step.storeAccess.method}` : ""}`}
              >
                {flow.name} · {number}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {keyspaces.length > 0 ? (
        <RedisSchema store={store} />
      ) : unread ? (
        // An empty canvas with its zoom controls would read as a schema
        // with nothing in it; what is true is that nothing was read.
        <div className="max-w-table">
          <Blank {...(store.source ? { where: store.source } : {})}>
            No table of {store.name} has been read. Tables come from the migrations or schema files an extractor reads for this store
            {store.source ? ", and this is where the catalog looks for them." : "; the catalog names no source for it yet."}
          </Blank>
        </div>
      ) : (
        <ErCanvas store={store} height="100%" />
      )}
    </>
  );

  if (!tabbed) {
    return (
      <div className="flex h-full flex-col">
        {header}
        {/* The canvas takes the rest of the pane rather than a fixed height: on
            this page the schema IS the content, so it gets the room. */}
        <div className="min-h-0 flex-1 overflow-auto p-gutter">{schema}</div>
      </div>
    );
  }

  return (
    /* `manual` for the reason the service page gives: each tab is a page, and
       the arrow keys should not render the canvas on the way past it. */
    <TabGroup
      manual
      as="div"
      className="flex h-full flex-col"
      selectedIndex={tab === "access" ? 1 : 0}
      onChange={(at) =>
        setParams(
          (was) => {
            const next = new URLSearchParams(was);
            if (at === 1) next.set("tab", "access");
            else next.delete("tab");
            return next;
          },
          { replace: true },
        )
      }
    >
      {header}
      <TabPanels className="min-h-0 flex-1">
        <TabPanel className="h-full overflow-auto p-gutter">{schema}</TabPanel>
        {/* The page header sits outside this scroller, so a section heading
            pinned inside it pins to the scroller's own top, not below the
            header height the shell publishes for the pages that scroll it. */}
        <TabPanel
          className="h-full overflow-auto p-gutter"
          style={{ "--page-header-h": "0px" } as CSSProperties}
        >
          <StoreAccessMatrix store={store} />
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
