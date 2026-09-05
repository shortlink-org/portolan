import { useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { Link, useParams, useSearchParams } from "react-router";
import { catalog, index } from "../data";
import { Empty, PageHeader, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
import { TAB_CLASS, TabCount, TabRow } from "../components/TabRow";
import { KindIcon } from "../components/kind";
import { MessageList, MethodRows } from "../components/MethodRows";
import { RowActions } from "../components/RowActions";
import { MODULE_ANCHOR, packageAnchor, paths, servicePath } from "../routes";
import { plural } from "../lib/format";
import {
  callsThrough,
  consumersOf,
  countsOf,
  dependenciesOf,
  dependentsOf,
  interfacesOf,
  packagesOf,
  registryUrl,
} from "../lib/registry";
import { NotFound } from "./NotFound";

const TABS = ["overview", "interfaces", "types", "deps"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

/**
 * One schema module.
 *
 * The page is assembled from the catalog rather than read off the module: a
 * module carries identity and inventory, and its interfaces are found through
 * `RpcService.module`. That keeps the shapes in one place — the interface that
 * declares them — instead of two that can disagree.
 */
export function ModulePage() {
  const { module: slug } = useParams();
  const [params, setParams] = useSearchParams();
  const [openShapes, setOpenShapes] = useState<ReadonlySet<string>>(new Set());

  const toggleShape = (id: string) =>
    setOpenShapes((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);

      return next;
    });

  const module = slug ? index.moduleBySlug.get(slug) : undefined;
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "overview";

  if (!module) return <NotFound kind="Module" id={slug} />;

  const counts = countsOf(index, module);
  const packages = packagesOf(index, module);
  const declared = interfacesOf(index, module);
  const consumers = consumersOf(index, module);
  const deps = dependenciesOf(index, module);
  const dependents = dependentsOf(catalog, module);
  const calls = callsThrough(catalog, module);
  const owner = module.owner ? index.serviceById.get(module.owner) : undefined;
  const url = registryUrl(module);

  const tabCounts: Record<Tab, number | null> = {
    overview: null,
    interfaces: counts.interfaces,
    types: counts.messages,
    deps: deps.length + dependents.length,
  };

  return (
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
        kind="buf module"
        name={module.name}
        id={module.id}
        pin={{ kind: "module", id: module.id }}
        right={
          url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mono text-muted hover:text-ink"
            >
              {module.registry} ↗
            </a>
          ) : undefined
        }
      >
        <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted">
          <span>
            {counts.packages} {plural(counts.packages, "package")}
          </span>
          <span>
            {counts.methods} {plural(counts.methods, "method")}
          </span>
          {module.commit ? (
            <Ident value={module.commit.slice(0, 12)} />
          ) : (
            /* Unpinned means two builds a day apart can describe two different
               modules under one name. Worth saying on the page, not only in a
               diagnostic nobody reads twice. */
            <span title="tracked by label rather than pinned to a commit">
              not pinned
            </span>
          )}
        </div>

        {/* The same underline the service page uses, and the same scrolling
            strip: these tabs switch the page under them rather than filtering
            a list beside it, and they run out of row at the same width. */}
        <div className="mt-4">
          <TabRow active={tab}>
            <TabList className="flex w-max gap-0">
              {TABS.map((name) => (
                <Tab
                  key={name}
                  className={({ selected }) => TAB_CLASS(selected)}
                >
                  {name}
                  {tabCounts[name] !== null ? (
                    <TabCount>{tabCounts[name]}</TabCount>
                  ) : null}
                </Tab>
              ))}
            </TabList>
          </TabRow>
        </div>
      </PageHeader>

      <TabPanels className="p-gutter">
        <TabPanel>
          <>
            <section id={MODULE_ANCHOR.packages} className="max-w-table">
              <SectionTitle anchor={MODULE_ANCHOR.packages}>
                Packages
              </SectionTitle>
              {packages.length === 0 ? (
                <Empty>this module declares no packages</Empty>
              ) : (
                <div className="rows">
                  {packages.map((pkg) => (
                    <Link
                      key={pkg.name}
                      to={`?tab=interfaces#${packageAnchor(pkg.name)}`}
                      className="row mono hover:text-ink"
                    >
                      <span className="flex-1 truncate">{pkg.name}</span>
                      <span className="tnum text-muted">
                        {pkg.interfaces.length}{" "}
                        {plural(pkg.interfaces.length, "interface")}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section id={MODULE_ANCHOR.used} className="mt-section max-w-table">
              <SectionTitle anchor={MODULE_ANCHOR.used}>
                Who uses it
              </SectionTitle>
              <div className="rows">
                <div className="row">
                  <span className="flex-1">published by</span>
                  {owner ? (
                    <Link
                      to={servicePath(owner.id) ?? "#"}
                      className="mono hover:text-ink"
                    >
                      {owner.id}
                    </Link>
                  ) : (
                    /* A module published by another team is the ordinary case,
                       and the reason `owner` is optional at all. */
                    <span className="text-muted">nobody in this catalog</span>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <SectionTitle>Read by</SectionTitle>
                {consumers.length === 0 ? (
                  <Empty>
                    nothing in this catalog reads this module but the service
                    that publishes it
                  </Empty>
                ) : (
                  <div className="rows">
                    {consumers.map((service) => (
                      <Link
                        key={service.id}
                        to={servicePath(service.id) ?? "#"}
                        className="row mono hover:text-ink"
                      >
                        <span className="flex-1 truncate">{service.id}</span>
                        <span className="tnum text-muted">
                          {
                            calls.filter((c) => c.service.id === service.id)
                              .length
                          }{" "}
                          calls
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="mt-section max-w-table">
              <SectionTitle>Files</SectionTitle>
              {module.files.length === 0 ? (
                <Empty>no files were recorded for this module</Empty>
              ) : (
                <ul className="rows">
                  {module.files.map((file) => (
                    <li key={file} className="row mono text-muted">
                      {file}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        </TabPanel>

        <TabPanel>
          <div id={MODULE_ANCHOR.interfaces} className="flex flex-col gap-6">
            {declared.length === 0 ? (
              <Empty>
                no interface in this catalog says it was declared in this module
              </Empty>
            ) : null}
            {packages.map((pkg) =>
              pkg.interfaces.length === 0 ? null : (
                <section key={pkg.name} id={packageAnchor(pkg.name)}>
                  <SectionTitle anchor={packageAnchor(pkg.name)}>
                    {pkg.name}
                  </SectionTitle>
                  <div className="flex flex-col gap-4">
                    {pkg.interfaces.map(({ provided, service }) => (
                      <div
                        key={provided.id}
                        className="rounded-card border border-line"
                      >
                        <div className="mono flex flex-wrap items-center gap-x-3 border-b px-3 py-1.5 border-line bg-surface">
                          <KindIcon kind="endpoint" />
                          <Ident value={provided.id} className="text-ink" />
                          {/* Which service actually answers on it: a module is
                              a schema, and a schema does not serve requests. */}
                          <Link
                            to={servicePath(service.id) ?? "#"}
                            className="ml-auto hover:text-ink"
                          >
                            {service.id}
                          </Link>
                        </div>
                        <MethodRows
                          provided={provided}
                          open={openShapes}
                          onToggle={toggleShape}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ),
            )}
          </div>
        </TabPanel>

        <TabPanel>
          <div id={MODULE_ANCHOR.types} className="flex flex-col gap-4">
            {counts.messages === 0 ? (
              <Empty>
                no shapes were read from this module — its interfaces list their
                methods but not the messages they move
              </Empty>
            ) : null}
            {declared.map(({ provided }) =>
              provided.messages?.length ? (
                <div
                  key={provided.id}
                  className="rounded-card border border-line"
                >
                  <div className="mono border-b px-3 py-1.5 border-line bg-surface">
                    <Ident value={provided.id} className="text-ink" />
                  </div>
                  <MessageList
                    provided={provided}
                    open={openShapes}
                    onToggle={toggleShape}
                  />
                </div>
              ) : null,
            )}
          </div>
        </TabPanel>

        <TabPanel>
          <div id={MODULE_ANCHOR.deps} className="max-w-table">
            <SectionTitle>Depends on</SectionTitle>
            {deps.length === 0 ? (
              <Empty>this module depends on nothing</Empty>
            ) : (
              <div className="rows">
                {deps.map((dep) =>
                  dep.module ? (
                    <Link
                      key={dep.id}
                      to={paths.module(dep.module.slug)}
                      className="row mono hover:text-ink"
                    >
                      <span className="flex-1 truncate">{dep.module.name}</span>
                      <RowActions copy={dep.id} />
                    </Link>
                  ) : (
                    /* A module may depend on one the estate never vendored.
                       That is normal, not broken: naming it and saying the
                       catalog does not hold it beats a link into nothing. */
                    <div key={dep.id} className="row mono text-muted">
                      <span className="flex-1 truncate">{dep.id}</span>
                      <span>not in this catalog</span>
                    </div>
                  ),
                )}
              </div>
            )}

            <div className="mt-section">
              <SectionTitle>Depended on by</SectionTitle>
              {dependents.length === 0 ? (
                <Empty>no module in this catalog depends on this one</Empty>
              ) : (
                <div className="rows">
                  {dependents.map((other) => (
                    <Link
                      key={other.id}
                      to={paths.module(other.slug)}
                      className="row mono hover:text-ink"
                    >
                      {other.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
