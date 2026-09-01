import { useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Link, useParams, useSearchParams } from "react-router";
import { catalog } from "../data";
import { flowsForService } from "../lib/derive";
import { adrsForService, isCurrent } from "../lib/adr";
import { AdrRow } from "../components/AdrRow";
import { EVENT_ANCHOR, SERVICE_ANCHOR, paths, servicePath } from "../routes";
import { Markdown } from "../components/Markdown";
import { middleTruncate, plural } from "../lib/format";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { KindIcon } from "../components/kind";
import { RowActions } from "../components/RowActions";
import {
  ContextPill,
  ProvenanceBadge,
  StatusChip,
} from "../components/primitives";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { NotFound } from "./NotFound";
import { C4View } from "../likec4/C4View";
import { serviceViewId } from "../likec4/ids";
import { index } from "../data";
import { storesOfService } from "../lib/data-model";
import { ErCanvas } from "../er/ErCanvas";
import { StoreHeader } from "../er/StoreHeader";

const TABS = [
  "overview",
  "provides",
  "consumes",
  "data",
  "flows",
  "decisions",
] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

export function ServicePage() {
  const { context: contextId, service: serviceSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const [showRetired, setShowRetired] = useState(false);
  // Read-only stores are off by default: they belong to someone else, and the
  // question this tab opens with is what THIS service is responsible for.
  const [showReadOnly, setShowReadOnly] = useState(false);
  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);

  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  if (!context || !service) return <NotFound kind="Service" id={serviceSlug} />;

  const events = service.aggregates.flatMap((aggregate) =>
    aggregate.events.map((event) => ({ aggregate, event })),
  );
  const stores = storesOfService(index, service.id);
  const flows = flowsForService(catalog, service.id);
  const adrs = adrsForService(catalog, service.id, context.id);
  const current = adrs.filter(isCurrent);
  const retired = adrs.filter((a) => !isCurrent(a));
  const counts: Record<Tab, number | null> = {
    overview: null,
    provides: service.provides.reduce((n, p) => n + p.methods.length, 0),
    consumes: service.consumes.length,
    data: stores.length,
    flows: flows.length,
    decisions: adrs.length,
  };

  return (
    /* `manual`: the arrow keys move focus and ⏎ commits, rather than switching
       the panel on every keypress. Each tab here is a page - one of them draws
       a C4 view - and automatic activation would render four of them on the
       way to the fifth, writing four URLs behind it. */
    <TabGroup
      manual
      as="div"
      className="h-full overflow-y-auto"
      selectedIndex={TABS.indexOf(tab)}
      onChange={(at) => {
        const next = TABS[at] ?? "overview";
        setParams(next === "overview" ? {} : { tab: next }, { replace: true });
      }}
    >
      <PageHeader
        kind="service"
        name={service.name}
        id={service.id}
        contextId={context.id}
        pin={{ kind: "service", id: service.id }}
        right={<ContextPill id={context.id} name={context.name} />}
      >
        <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          <Ident value={service.repo}>{middleTruncate(service.repo, 32)}</Ident>
          <Ident value={service.path}>{middleTruncate(service.path, 32)}</Ident>
          <span aria-hidden className="h-4 w-px bg-line-strong" />
          {/* Both counts land in the section that lists what they counted;
              the tabs above do the same job for the other four. */}
          <a
            href={`#${SERVICE_ANCHOR.aggregates}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{service.aggregates.length}</span>{" "}
            {plural(service.aggregates.length, "aggregate")}
          </a>
          <a
            href={`#${SERVICE_ANCHOR.events}`}
            className="rounded-control hover:text-ink"
          >
            <span className="tnum">{events.length}</span>{" "}
            {plural(events.length, "event")}
          </a>
        </div>

        {/* Tabs keep the underline rather than becoming a segmented box: they
            switch the page under them, they do not filter a list beside them.
            The 2px rule is always drawn, transparent when idle, so selecting a
            tab never lifts the row. */}
        <TabList className="mt-4 flex gap-0">
          {TABS.map((t) => (
            <Tab
              key={t}
              className={({ selected }) =>
                `mono rounded-t-control border-b-2 px-3 py-1.5 t-micro transition-colors focus:outline-none ${
                  selected
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`
              }
            >
              {t}
              {counts[t] !== null ? (
                <span className="tnum ml-1.5 text-muted">{counts[t]}</span>
              ) : null}
            </Tab>
          ))}
        </TabList>
      </PageHeader>

      <TabPanels className="p-gutter">
        <TabPanel>
          <>
            <SectionTitle>Model</SectionTitle>
            <C4View viewId={serviceViewId(service)} height={300} />
            <div className="mt-section" />
            <Markdown>{service.readme}</Markdown>
            <section
              id={SERVICE_ANCHOR.aggregates}
              className="mt-section max-w-table"
            >
              <SectionTitle anchor={SERVICE_ANCHOR.aggregates}>
                Aggregates
              </SectionTitle>
              {/* icon, slug, name, event count, actions - one column each,
                  so the counts stack up instead of drifting with the name. */}
              <div
                className="rows grid-cols-[auto_auto_1fr_auto_auto]"
                data-nav-list
              >
                {service.aggregates.map((aggregate) => {
                  const to = paths.aggregate(
                    context.id,
                    service.slug,
                    aggregate.slug,
                  );
                  return (
                    <div key={aggregate.id} className="row px-2 py-1.5">
                      <KindIcon kind="aggregate" />
                      <Link
                        to={to}
                        data-nav-item
                        className="mono rounded-control"
                      >
                        {aggregate.slug}
                      </Link>
                      <span className="meta">{aggregate.name}</span>
                      <Link
                        to={`${to}#bb-events`}
                        className="mono rounded-control hover:underline"
                        style={{
                          color:
                            aggregate.events.length === 0
                              ? "var(--status-declared)"
                              : "var(--fg-muted)",
                        }}
                      >
                        <span className="tnum">{aggregate.events.length}</span>{" "}
                        events
                      </Link>
                      <RowActions
                        copy={aggregate.id}
                        reveal={aggregate.id}
                        label={aggregate.name}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              id={SERVICE_ANCHOR.events}
              className="mt-section max-w-table"
            >
              <SectionTitle
                anchor={SERVICE_ANCHOR.events}
                right={
                  <span>
                    everything this service announces
                  </span>
                }
              >
                Events
              </SectionTitle>
              {events.length === 0 ? (
                <Empty>this service announces nothing — it only answers</Empty>
              ) : (
                <div
                  className="rows grid-cols-[auto_auto_1fr_auto_auto]"
                  data-nav-list
                >
                  {events.map(({ aggregate, event }) => {
                    const to = paths.event(
                      context.id,
                      service.slug,
                      aggregate.slug,
                      event.slug,
                    );
                    return (
                      <div key={event.id} className="row gap-2">
                        <KindIcon kind="event" />
                        <Link
                          to={to}
                          data-nav-item
                          className="mono rounded-control"
                          style={{ color: "var(--kind-event)" }}
                        >
                          {event.name}
                        </Link>
                        <span className="mono text-muted">
                          {aggregate.slug}
                        </span>
                        <Link
                          to={`${to}#${EVENT_ANCHOR.consumers}`}
                          className="mono rounded-control text-muted hover:text-ink"
                        >
                          <span className="tnum">{event.consumers.length}</span>{" "}
                          {event.consumers.length === 1
                            ? "consumer"
                            : "consumers"}
                        </Link>
                        <RowActions
                          copy={event.id}
                          reveal={event.id}
                          label={event.name}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Who calls this service is nowhere else on the page: `provides`
                and `consumes` both point outwards. Flows and decisions have
                tabs of their own, so they are counted here, not repeated. */}
            <WhatLinksHere
              target={{ kind: "service", id: service.id }}
              elsewhere={{
                flow: { href: "?tab=flows", label: "the flows tab" },
                adr: { href: "?tab=decisions", label: "the decisions tab" },
              }}
              empty="nothing in the catalog calls this service or listens to it"
            />
          </>
        </TabPanel>

        <TabPanel>
          <div className="flex flex-col gap-4">
            {service.provides.length === 0 ? (
              <Empty>this service answers nothing — it only listens</Empty>
            ) : null}
            {service.provides.map((provided) => (
              <div
                key={provided.id}
                className="rounded-card border border-line"
              >
                <div className="mono flex flex-wrap items-center gap-x-3 border-b px-3 py-1.5 border-line bg-surface">
                  <Ident value={provided.id} className="text-ink" />
                  <Ident value={provided.source} className="ml-auto" />
                </div>
                <ul data-nav-list>
                  {provided.methods.map((method) => (
                    <li
                      key={method}
                      className="row rounded-none border-x-0 border-t-0 last:border-b-0"
                    >
                      <Ident value={`${provided.id}/${method}`} />
                      <RowActions copy={`${provided.id}/${method}`} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </TabPanel>

        <TabPanel>
          <div className="flex flex-col gap-1" data-nav-list>
            {service.consumes.length === 0 ? (
              <Empty>this service calls nobody — it only answers</Empty>
            ) : null}
            {service.consumes.map((call) => {
              const to = servicePath(call.peer);
              return (
                <div
                  key={call.id}
                  className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-control border px-3 py-2"
                  style={{
                    borderColor:
                      call.status === "unresolved"
                        ? "var(--status-unresolved)"
                        : "var(--border)",
                  }}
                >
                  <Ident value={call.id} className="text-ink" />
                  <StatusChip status={call.status} />
                  <Ident value={call.source} className="ml-auto" />
                  <RowActions
                    copy={call.id}
                    {...(to ? { reveal: call.peer } : {})}
                    label={call.id}
                  />
                  <div className="mono w-full text-muted">
                    peer:{" "}
                    {to ? (
                      <Link to={to} className="text-accent">
                        {call.peer}
                      </Link>
                    ) : (
                      <span className="text-unresolved">
                        {call.peer} — not in the catalog
                      </span>
                    )}
                  </div>
                  {call.note ? (
                    <p className="w-full border-l-2 pl-2 border-line-strong text-muted">
                      {call.note}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </TabPanel>

        <TabPanel>
          {stores.length === 0 ? (
            <Empty>
              nothing says where this service keeps its state — stores are read
              from migrations, and none were found for this repository
            </Empty>
          ) : null}

          {stores.some((s) => s.access === "reads") ? (
            <button
              type="button"
              onClick={() => setShowReadOnly((v) => !v)}
              aria-pressed={showReadOnly}
              className="mono mb-4 rounded-control border border-dashed px-2 py-1 border-line-strong text-muted hover:bg-surface"
            >
              {showReadOnly ? "hide" : "show"}{" "}
              {stores.filter((s) => s.access === "reads").length} read-only{" "}
              {plural(
                stores.filter((s) => s.access === "reads").length,
                "store",
              )}
            </button>
          ) : null}

          <div className="flex flex-col gap-8">
            {stores
              .filter((s) => showReadOnly || s.access === "owns")
              .map(({ store, access }) => (
                <section key={store.id}>
                  <StoreHeader store={store} access={access} />
                  <div className="mt-3">
                    {store.tables.length === 0 ? (
                      /* A store whose schema nobody has read is still a fact
                         worth drawing — a cache IS part of the picture — but an
                         empty canvas would say the opposite. */
                      <Empty>
                        no schema extracted — {store.name} is in the catalog by
                        kind and owner only
                      </Empty>
                    ) : (
                      <ErCanvas store={store} ghost={access === "reads"} />
                    )}
                  </div>
                </section>
              ))}
          </div>
        </TabPanel>

        <TabPanel>
          <div className="flex flex-col gap-1" data-nav-list>
            {flows.length === 0 ? (
              <Empty>no chart runs through here yet</Empty>
            ) : null}
            {flows.map((flow) => {
              return (
                <Link
                  key={flow.slug}
                  to={paths.flow(flow.slug)}
                  data-nav-item
                  className="row flex-wrap"
                >
                  <span className="font-semibold">{flow.name}</span>
                  <span className="mono text-muted">{flow.slug}</span>
                  {/* How far this flow can be trusted, in one word. There is
                      no score beside it: the per-step statuses on the flow
                      page are where that question is actually answered. */}
                  <span className="ml-auto shrink-0">
                    <ProvenanceBadge
                      provenance={flow.provenance}
                      source={flow.source}
                      verifiedAt={flow.verifiedAt}
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        </TabPanel>

        <TabPanel>
          <div className="flex max-w-prose flex-col gap-1">
            {adrs.length === 0 ? (
              <Empty>nothing on the record names this service</Empty>
            ) : null}
            {current.map((adr) => (
              <AdrRow key={adr.id} adr={adr} />
            ))}
            {retired.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowRetired((v) => !v)}
                  aria-expanded={showRetired}
                  className="mono mt-1 self-start border border-dashed px-2 py-1 border-line-strong text-muted hover:bg-surface"
                >
                  {showRetired ? "hide" : "show"} {retired.length}{" "}
                  {retired.every((a) => a.status === "superseded")
                    ? "superseded"
                    : "no longer in force"}
                </button>
                {showRetired
                  ? retired.map((adr) => <AdrRow key={adr.id} adr={adr} />)
                  : null}
              </>
            ) : null}
          </div>
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
