import { plural } from "../lib/format";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Link, useParams } from "react-router";
import { catalog } from "../data";
import { externalConsumers } from "../lib/integrations";
import { servicePath } from "../routes";
import { Ident } from "../components/Ident";
import { MethodRows } from "../components/MethodRows";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { NotFound } from "./NotFound";

export function ExternalPage() {
  const { external: slug } = useParams();
  const external = (catalog.externals ?? []).find(
    (candidate) => candidate.slug === slug,
  );
  const [openShapes, setOpenShapes] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  if (!external) return <NotFound kind="External API" id={slug} />;

  const consumers = externalConsumers(catalog, external.id);
  const methods = external.provides.flatMap((provided) =>
    provided.methods.map((method) => ({ provided, method })),
  );
  const soap = methods.filter(({ method }) => method.soap).length;
  const urlIsEndpoint = methods.some(
    ({ method }) => method.soap?.endpoint === external.url,
  );
  const usedByMethod = new Map<string, typeof consumers>();
  for (const consumer of consumers) {
    for (const call of consumer.calls) {
      const current = usedByMethod.get(call.id) ?? [];
      if (!current.some(({ service }) => service.id === consumer.service.id)) {
        current.push(consumer);
      }
      usedByMethod.set(call.id, current);
    }
  }
  const filtering = !showAll && usedByMethod.size > 0;
  const shownProvides = external.provides
    .map((provided) => ({
      ...provided,
      totalMethods: provided.methods.length,
      methods: filtering
        ? provided.methods.filter((method) =>
            usedByMethod.has(`${provided.id}/${method.name}`),
          )
        : provided.methods,
    }))
    .filter((provided) => provided.methods.length > 0);
  const toggleShape = (id: string) =>
    setOpenShapes((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        kind="external API"
        name={external.name}
        id={external.id}
        right={<span className="chip-lg">outside the estate</span>}
      >
        {external.summary ? (
          <p className="mt-2 max-w-prose text-muted">{external.summary}</p>
        ) : null}
        <div className="mono mt-2 flex flex-wrap items-center gap-3 text-muted">
          <span>
            <span className="tnum">{external.provides.length}</span>{" "}
            {plural(external.provides.length, "interface")}
          </span>
          <span>
            <span className="tnum">{methods.length}</span>{" "}
            {plural(methods.length, "operation")}
          </span>
          {soap ? (
            <span>
              <span className="tnum">{soap}</span> SOAP
            </span>
          ) : null}
          <span>
            <span className="tnum">{consumers.length}</span> consumers
          </span>
          {external.url ? (
            <a
              href={external.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-control text-accent hover:underline"
            >
              {urlIsEndpoint ? "SOAP endpoint" : "provider documentation"}{" "}
              <ExternalLink size={12} />
            </a>
          ) : null}
        </div>
      </PageHeader>

      <div className="p-gutter">
        <section className="max-w-table">
          <SectionTitle>Used by</SectionTitle>
          {consumers.length === 0 ? (
            <Empty>no component in this catalog calls this API</Empty>
          ) : (
            <div className="rows grid-cols-[1fr_auto_auto]" data-nav-list>
              {consumers.map(({ service, calls }) => {
                const to = servicePath(service.id);
                return (
                  <div key={service.id} className="row px-3 py-2">
                    {to ? (
                      <Link
                        to={`${to}?tab=consumes`}
                        data-nav-item
                        className="font-medium text-ink"
                      >
                        {service.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">
                        {service.name}
                      </span>
                    )}
                    <Ident value={service.id} />
                    <span className="mono ml-auto text-muted">
                      <span className="tnum">{calls.length}</span> calls
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-section max-w-table">
          <SectionTitle
            right={
              usedByMethod.size > 0 && usedByMethod.size < methods.length ? (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? "show used only" : `show all ${methods.length}`}
                </button>
              ) : null
            }
          >
            Interfaces
          </SectionTitle>
          <div className="flex flex-col gap-3">
            {shownProvides.map((provided) => (
              <div
                key={provided.id}
                className="rounded-card border border-line"
              >
                <div className="mono flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
                  <Ident value={provided.id} className="text-ink" />
                  <span className="tnum text-muted">
                    {filtering
                      ? `${provided.methods.length}/${provided.totalMethods} used`
                      : `${provided.methods.length} operations`}
                  </span>
                  <Ident value={provided.source} className="ml-auto" />
                </div>
                <MethodRows
                  provided={provided}
                  open={openShapes}
                  onToggle={toggleShape}
                  runs={(method) => {
                    const users =
                      usedByMethod.get(`${provided.id}/${method.name}`) ?? [];
                    if (users.length === 0) return null;
                    return (
                      <p className="mono mt-0.5 flex flex-wrap gap-1 text-muted">
                        used by{" "}
                        {users.map(({ service }) => {
                          const to = servicePath(service.id);
                          return to ? (
                            <Link
                              key={service.id}
                              to={`${to}?tab=consumes`}
                              className="text-accent"
                            >
                              {service.id}
                            </Link>
                          ) : (
                            <span key={service.id}>{service.id}</span>
                          );
                        })}
                      </p>
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
