import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Cloud,
  ExternalLink,
  Server,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { IntegrationGroup } from "../lib/integrations";
import { paths, servicePath } from "../routes";
import { Empty, SectionTitle } from "./PageHeader";
import { Ident } from "./Ident";
import { RowActions } from "./RowActions";
import { SoapCallContract } from "./WsdlReference";
import { StatusChip } from "./primitives";

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2">
      <div className="tnum text-lg font-semibold text-ink">{value}</div>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function kindLabel(group: IntegrationGroup): string {
  if (group.kind === "external") return "outside the estate";
  if (group.kind === "service") return "internal service";
  return "contract missing";
}

function integrationTone(group: IntegrationGroup): string {
  if (group.documented === group.operations.length) {
    return "var(--status-verified)";
  }
  if (group.documented === 0) return "var(--status-unresolved)";
  return "var(--status-declared)";
}

function IntegrationIcon({ group }: { group: IntegrationGroup }) {
  const Icon =
    group.kind === "external"
      ? Cloud
      : group.kind === "service"
        ? Server
        : CircleAlert;
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-control border bg-canvas"
      style={{
        borderColor: integrationTone(group),
        color: integrationTone(group),
      }}
    >
      <Icon size={15} aria-hidden />
    </span>
  );
}

export function Integrations({ groups }: { groups: IntegrationGroup[] }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const operations = groups.flatMap((group) => group.operations);
  const documented = operations.filter(
    ({ call }) => call.status !== "unresolved",
  ).length;
  const soap = operations.filter(({ protocol }) => protocol === "SOAP");
  const documentedSOAP = soap.filter(
    ({ call }) => call.status !== "unresolved",
  ).length;

  if (groups.length === 0) {
    return <Empty>this service has no outbound integrations</Empty>;
  }

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="max-w-table">
      <SectionTitle
        right={<span>derived from outbound calls and their contracts</span>}
      >
        Integration coverage
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric value={groups.length} label="systems" />
        <Metric value={operations.length} label="outbound calls" />
        <Metric
          value={`${documented}/${operations.length}`}
          label="documented"
        />
        <Metric
          value={soap.length ? `${documentedSOAP}/${soap.length}` : "—"}
          label="SOAP covered"
        />
      </div>

      <div className="mt-section flex flex-col gap-2" data-nav-list>
        {groups.map((group) => {
          const shown = open.has(group.id);
          const percent = group.operations.length
            ? Math.round((group.documented / group.operations.length) * 100)
            : 0;
          const internalPath = group.service
            ? servicePath(group.service.id)
            : null;
          const tone = integrationTone(group);
          const coverageLabel =
            group.documented === group.operations.length
              ? "fully documented"
              : group.documented === 0
                ? "contract missing"
                : `${percent}% documented`;

          return (
            <section
              key={group.id}
              className="overflow-hidden rounded-card border border-line bg-canvas"
              style={{ borderLeftColor: tone, borderLeftWidth: 2 }}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface px-3 py-2.5">
                <button
                  type="button"
                  data-nav-item
                  aria-expanded={shown}
                  onClick={() => toggle(group.id)}
                  className="flex min-w-48 flex-1 items-center gap-2 rounded-control text-left"
                >
                  {shown ? (
                    <ChevronDown size={14} className="shrink-0 text-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted" />
                  )}
                  <IntegrationIcon group={group} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">
                      {group.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`chip ${group.kind === "unresolved" ? "status-unresolved" : ""}`}
                      >
                        {kindLabel(group)}
                      </span>
                      {group.protocols.map((protocol) => (
                        <span key={protocol} className="chip mono">
                          {protocol}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
                <div className="mono min-w-28 text-right text-muted">
                  <div>
                    <span className="tnum text-ink">
                      {group.operations.length}
                    </span>{" "}
                    {group.operations.length === 1 ? "call" : "calls"}
                  </div>
                  <div className="t-micro" style={{ color: tone }}>
                    {coverageLabel}
                  </div>
                </div>
                {group.external ? (
                  <Link
                    to={paths.external(group.external.slug)}
                    className="btn-quiet shrink-0"
                    title={`Open ${group.external.name} contract`}
                  >
                    view contract <ExternalLink size={12} />
                  </Link>
                ) : internalPath ? (
                  <Link
                    to={internalPath}
                    data-peek={group.service?.id}
                    className="btn-quiet shrink-0"
                  >
                    view service
                  </Link>
                ) : null}
              </div>
              <div
                className="h-0.5 bg-line"
                aria-label={`${percent}% documented`}
              >
                <div
                  className="h-full"
                  style={{ width: `${percent}%`, backgroundColor: tone }}
                />
              </div>

              {shown ? (
                <div>
                  {group.operations.map(
                    ({ call, provided, method, protocol }) => (
                      <div
                        key={call.id}
                        className="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line px-3 py-2 first:border-t-0"
                      >
                        <span className="chip mono">{protocol}</span>
                        <Ident value={call.id} className="min-w-0 text-ink" />
                        <StatusChip status={call.status} />
                        <Ident value={call.source} className="ml-auto" />
                        <RowActions copy={call.id} label={call.id} />
                        {method?.http ? (
                          <p className="mono w-full text-muted">
                            {method.http.method ? `${method.http.method} ${method.http.path}` : method.http.path}
                          </p>
                        ) : null}
                        {call.note ? (
                          <p className="w-full border-l-2 border-line-strong pl-2 text-muted">
                            {call.note}
                          </p>
                        ) : null}
                        {provided && method?.soap ? (
                          <SoapCallContract
                            provided={provided}
                            method={method}
                          />
                        ) : call.status === "unresolved" ? (
                          <p className="w-full text-unresolved">
                            no matching operation was found in the available
                            contracts
                          </p>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
