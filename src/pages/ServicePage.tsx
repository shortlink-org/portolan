import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { catalog } from "../data";
import { flowsForService } from "../lib/derive";
import { adrsForService, isCurrent } from "../lib/adr";
import { AdrRow } from "../components/AdrRow";
import { paths, servicePath } from "../routes";
import { Markdown } from "../components/Markdown";
import { middleTruncate } from "../lib/format";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import {
  ContextPill,
  ProvenanceBadge,
  StatusChip,
} from "../components/primitives";
import { NotFound } from "./NotFound";
import { C4View } from "../likec4/C4View";
import { serviceViewId } from "../likec4/ids";

const TABS = [
  "overview",
  "provides",
  "consumes",
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
  const context = catalog.contexts.find((c) => c.id === contextId);
  const service = context?.services.find((s) => s.slug === serviceSlug);

  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  if (!context || !service) return <NotFound kind="Service" id={serviceSlug} />;

  const flows = flowsForService(catalog, service.id);
  const adrs = adrsForService(catalog, service.id, context.id);
  const current = adrs.filter(isCurrent);
  const retired = adrs.filter((a) => !isCurrent(a));
  const counts: Record<Tab, number | null> = {
    overview: null,
    provides: service.provides.reduce((n, p) => n + p.methods.length, 0),
    consumes: service.consumes.length,
    flows: flows.length,
    decisions: adrs.length,
  };

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind="service"
        name={service.name}
        id={service.id}
        contextId={context.id}
        right={<ContextPill id={context.id} name={context.name} />}
      >
        <div className="mono mt-2 flex flex-wrap gap-x-4 text-muted">
          <span title={service.repo}>{middleTruncate(service.repo, 32)}</span>
          <span title={service.path}>{middleTruncate(service.path, 32)}</span>
          <span className="tnum">
            {service.aggregates.length} aggregates ·{" "}
            {service.aggregates.reduce((n, a) => n + a.events.length, 0)} events
          </span>
        </div>

        {/* Tabs keep the underline rather than becoming a segmented box: they
            switch the page under them, they do not filter a list beside them.
            The 2px rule is always drawn, transparent when idle, so selecting a
            tab never lifts the row. */}
        <div className="mt-4 flex gap-0" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              onClick={() =>
                setParams(t === "overview" ? {} : { tab: t }, { replace: true })
              }
              aria-selected={tab === t}
              aria-current={tab === t ? "page" : undefined}
              className="mono rounded-t-control border-b-2 px-3 py-1.5 t-micro transition-colors"
              style={{
                borderColor: tab === t ? "var(--accent)" : "transparent",
                color: tab === t ? "var(--fg)" : "var(--fg-muted)",
              }}
            >
              {t}
              {counts[t] !== null ? (
                <span className="tnum ml-1.5 text-muted">{counts[t]}</span>
              ) : null}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="p-gutter">
        {tab === "overview" ? (
          <>
            <SectionTitle>Model</SectionTitle>
            <C4View viewId={serviceViewId(service)} height={300} />
            <div className="mt-section" />
            <Markdown>{service.readme}</Markdown>
            <div className="mt-section max-w-prose">
              <SectionTitle>Aggregates</SectionTitle>
              <div className="flex flex-col gap-1">
                {service.aggregates.map((aggregate) => (
                  <Link
                    key={aggregate.id}
                    to={paths.aggregate(
                      context.id,
                      service.slug,
                      aggregate.slug,
                    )}
                    className="row px-2 py-1.5"
                  >
                    <span className="mono">{aggregate.slug}</span>
                    <span className="text-muted">{aggregate.name}</span>
                    <span
                      className="mono ml-auto"
                      style={{
                        color:
                          aggregate.events.length === 0
                            ? "var(--status-declared)"
                            : "var(--fg-muted)",
                      }}
                    >
                      {aggregate.events.length} events
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {tab === "provides" ? (
          <div className="flex flex-col gap-4">
            {service.provides.length === 0 ? (
              <Empty>this service provides no rpc</Empty>
            ) : null}
            {service.provides.map((provided) => (
              <div key={provided.id} className="border border-line">
                <div className="mono flex flex-wrap items-center gap-x-3 border-b px-3 py-1.5 border-line bg-surface">
                  <span>{provided.id}</span>
                  <span className="ml-auto text-muted">{provided.source}</span>
                </div>
                <ul>
                  {provided.methods.map((method) => (
                    <li
                      key={method}
                      className="mono border-b px-3 py-1 last:border-b-0 border-line"
                    >
                      {provided.id}/{method}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "consumes" ? (
          <div className="flex flex-col gap-1">
            {service.consumes.length === 0 ? (
              <Empty>this service calls nobody</Empty>
            ) : null}
            {service.consumes.map((call) => {
              const to = servicePath(call.peer);
              return (
                <div
                  key={call.id}
                  className="flex flex-wrap items-start gap-x-3 gap-y-1 border px-3 py-2"
                  style={{
                    borderColor:
                      call.status === "unresolved"
                        ? "var(--status-unresolved)"
                        : "var(--border)",
                  }}
                >
                  <span className="mono">{call.id}</span>
                  <StatusChip status={call.status} />
                  <span className="mono ml-auto text-muted">{call.source}</span>
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
        ) : null}

        {tab === "decisions" ? (
          <div className="flex max-w-prose flex-col gap-1">
            {adrs.length === 0 ? (
              <Empty>no decision names this service</Empty>
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
        ) : null}

        {tab === "flows" ? (
          <div className="flex flex-col gap-1">
            {flows.length === 0 ? (
              <Empty>no flow involves this service</Empty>
            ) : null}
            {flows.map((flow) => {
              return (
                <Link
                  key={flow.slug}
                  to={paths.flow(flow.slug)}
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
        ) : null}
      </div>
    </div>
  );
}
