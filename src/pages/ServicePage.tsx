import { useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Link, useParams, useSearchParams } from "react-router";
import { catalog } from "../data";
import { flowRoles } from "../lib/derive";
import { treeHref } from "../lib/source-link";
import { flowHealth } from "../lib/flow-tree";
import { adrsForService, isCurrent } from "../lib/adr";
import { AdrRow } from "../components/AdrRow";
import { EVENT_ANCHOR, SERVICE_ANCHOR, aggregatePath, paths, servicePath } from "../routes";
import { Markdown } from "../components/Markdown";
import { middleTruncate, plural } from "../lib/format";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { MessageList, MethodRows } from "../components/MethodRows";
import { docPathOf, pickSpec } from "../lib/source-doc";
import { ApiReference, hasSpec } from "../components/ApiReference";
import {
  AsyncApiReference,
  hasAsyncSpec,
} from "../components/AsyncApiReference";
import { ChannelRows } from "../components/ChannelRows";
import { ModuleSpec } from "../components/SourceDoc";
import { methodCount, operationsExposedBy } from "../lib/api";
import { KindIcon } from "../components/kind";
import { RowActions } from "../components/RowActions";
import {
  ContextPill,
  StatusChip,
} from "../components/primitives";
import { WhatLinksHere } from "../components/WhatLinksHere";
import { NotFound } from "./NotFound";
import { C4View } from "../likec4/C4View";
import { LevelSwitch } from "../likec4/levels";
import type { C4Level } from "../likec4/levels";
import { serviceInsideViewId, serviceViewId } from "../likec4/ids";
import { index } from "../data";
import { storesOfService } from "../lib/data-model";
import { ErCanvas } from "../er/ErCanvas";
import { StoreHeader } from "../er/StoreHeader";

const TABS = [
  "overview",
  "provides",
  // The document beside the facts drawn from it. Always present rather than
  // appearing only for services that have one, because every other tab on this
  // page is too - a tab that comes and goes makes the page a different shape
  // per service and the url stop meaning the same thing.
  "spec",
  "consumes",
  // What the service says on the bus: the channels it declares, and the
  // document they were read out of. Beside `provides` and `spec` rather than
  // inside them, because a call and a message are answered differently and a
  // reader is asking one question or the other.
  "bus",
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
  /** Which C4 level the model canvas is drawn at: the service, or its parts. */
  const [level, setLevel] = useState<C4Level>(2);
  // Read-only stores are off by default: they belong to someone else, and the
  // question this tab opens with is what THIS service is responsible for.
  const [showReadOnly, setShowReadOnly] = useState(false);

  // Which request and response shapes are open. Collapsed by default: the
  // question the provides tab answers first is "what can I call", and a page
  // that opens with six schemas answers a question nobody asked yet.
  const [openShapes, setOpenShapes] = useState<ReadonlySet<string>>(new Set());
  const toggleShape = (id: string) =>
    setOpenShapes((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);

      return next;
    });
  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);

  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  if (!context || !service) return <NotFound kind="Service" id={serviceSlug} />;

  const events = service.aggregates.flatMap((aggregate) =>
    aggregate.events.map((event) => ({ aggregate, event })),
  );
  const stores = storesOfService(index, service.id);
  const flows = flowRoles(catalog, service.id);
  const tree = treeHref(service.path, service);
  const adrs = adrsForService(catalog, service.id, context.id);
  const current = adrs.filter(isCurrent);
  const retired = adrs.filter((a) => !isCurrent(a));
  // What the spec tab has to show: a document this repository holds, else the
  // schema module the interfaces were declared in, else nothing.
  const spec = pickSpec(service, hasSpec);
  // The channels the service declares, and the document behind them when this
  // repository holds it. A channel names its own source, so the tab does not
  // have to be told where to look.
  const channels = service.channels ?? [];
  const busDoc = channels
    .map((channel) => channel.source)
    .find((source) => source !== undefined && hasAsyncSpec(source));

  const counts: Record<Tab, number | null> = {
    overview: null,
    provides: methodCount(service),
    spec: null,
    consumes: service.consumes.length,
    bus: channels.length,
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
          {tree ? (
            <a
              href={tree}
              target="_blank"
              rel="noreferrer"
              className="rounded-control text-accent hover:underline"
              title="Open the service's directory on the forge, at the built commit"
            >
              open ↗
            </a>
          ) : null}
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
            {/* Two scopes of the same service: the box among the ones it
                touches, and the box opened up. The page already lists the
                aggregates below, so it opens on the level the list cannot
                give — who is on the other end. */}
            <SectionTitle
              right={
                <LevelSwitch
                  level={level}
                  onLevel={setLevel}
                  levels={[
                    { level: 2, label: "neighbours" },
                    { level: 3, label: "inside" },
                  ]}
                />
              }
            >
              Model
            </SectionTitle>
            <C4View
              viewId={
                level === 3
                  ? serviceInsideViewId(service)
                  : serviceViewId(service)
              }
              height={300}
            />
            <div className="mt-section" />
            <Markdown mermaid>{service.readme}</Markdown>
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
                right={<span>everything this service announces</span>}
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
            {service.provides.map((provided) => {
              const module = provided.module
                ? index.moduleById.get(provided.module)
                : undefined;

              return (
                <div
                  key={provided.id}
                  className="rounded-card border border-line"
                >
                  <div className="mono flex flex-wrap items-center gap-x-3 border-b px-3 py-1.5 border-line bg-surface">
                    <Ident value={provided.id} className="text-ink" />
                    {/* The schema this interface was declared in. A link
                        rather than a chip that only names it: the module page
                        is where "who else reads this" is answered. */}
                    {module ? (
                      <Link
                        to={paths.module(module.slug)}
                        className="chip hover:text-ink"
                        title={module.id}
                      >
                        <KindIcon kind="module" />
                        {module.name}
                      </Link>
                    ) : null}
                    <Ident
                      value={docPathOf(provided.source)}
                      className="ml-auto"
                      title={provided.source}
                    />
                  </div>
                  {/* Drawn by the same component the module page uses, so a
                      method reads identically in both places. */}
                  <MethodRows
                    provided={provided}
                    open={openShapes}
                    onToggle={toggleShape}
                    runs={(method) => {
                      // What the endpoint actually runs. More than one is
                      // normal: a handler that resolves a token before changing
                      // a password has run two use cases, in two aggregates.
                      const runs = operationsExposedBy(service, method.name);
                      if (runs.length === 0) return null;

                      return (
                        <p className="mono mt-0.5 flex flex-wrap items-center gap-x-2 text-muted">
                          <span>runs</span>
                          {runs.map(({ aggregate, operation }) => {
                            const to = aggregatePath(aggregate.id);
                            const label = `${aggregate.slug}.${operation.id}`;

                            return to ? (
                              <Link
                                key={label}
                                to={to}
                                className="rounded-control hover:text-ink"
                                title={`${operation.kind} of ${aggregate.name}`}
                              >
                                {label}
                              </Link>
                            ) : (
                              <span key={label}>{label}</span>
                            );
                          })}
                        </p>
                      );
                    }}
                  />
                  <MessageList
                    provided={provided}
                    open={openShapes}
                    onToggle={toggleShape}
                  />
                </div>
              );
            })}
          </div>
        </TabPanel>

        <TabPanel>
          {spec === null ? (
            <Empty>
              no api document in this catalog — nothing under this service names
              one
            </Empty>
          ) : spec.kind === "openapi" ? (
            <ApiReference source={spec.source} />
          ) : (
            /* A proto is drawn from the catalog rather than as raw text. The
               rule ApiReference states - draw the document because the catalog
               cannot carry its shape - does not hold here: the extractor read
               exactly that shape, and a <pre> could not link a field to the
               shared type it refs. */
            <ModuleSpec moduleId={spec.moduleId} />
          )}
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
          {channels.length === 0 ? (
            <Empty>
              nothing says what this service puts on the bus — channels are read
              from an AsyncAPI document, and none was found for this repository
            </Empty>
          ) : (
            <ChannelRows channels={channels} service={service.id} />
          )}

          {busDoc ? (
            <>
              <div className="mt-section" />
              <SectionTitle>Document</SectionTitle>
              <AsyncApiReference source={busDoc} />
            </>
          ) : null}
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
            {flows.map(({ flow, role, trigger, firstStepId, steps, publishes, consumes }) => {
              // What this service does in the flow, in one phrase, and the
              // counts behind it. The link lands on the first step the
              // service is on rather than the top of the rail.
              const does =
                role === "initiates"
                  ? `answers ${trigger ?? "the call in"}`
                  : role === "reacts"
                    ? `reacts to ${trigger ?? "an event"}`
                    : "on the way";
              return (
                <Link
                  key={flow.slug}
                  to={firstStepId ? paths.flowStep(flow.slug, firstStepId) : paths.flow(flow.slug)}
                  data-nav-item
                  className="row flex-wrap items-baseline gap-x-3"
                >
                  <span className="font-semibold">{flow.name}</span>
                  <span className="mono text-muted">{flow.slug}</span>
                  <span className="mono text-muted">{does}</span>
                  <span className="mono ml-auto flex shrink-0 items-center gap-3 text-muted">
                    {publishes.length > 0 ? (
                      <span title={`publishes ${publishes.join(", ")}`}>
                        ↑ <span className="tnum">{publishes.length}</span>
                      </span>
                    ) : null}
                    {consumes.length > 0 ? (
                      <span title={`consumes ${consumes.join(", ")}`}>
                        ↓ <span className="tnum">{consumes.length}</span>
                      </span>
                    ) : null}
                    <span title="steps this service is on">
                      <span className="tnum">{steps}</span> step{steps === 1 ? "" : "s"}
                    </span>
                    <StatusChip status={flowHealth(flow)} />
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
