import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import { useDocumentTitle } from "../app/title";
import { ownersOf } from "../catalog";
import { ContextPill } from "../components/primitives";
import { Empty } from "../components/PageHeader";
import { catalog } from "../data";
import type { OwnedService } from "../lib/ownership";
import { ownershipIndex } from "../lib/ownership";
import { plural } from "../lib/format";
import { paths } from "../routes";

type Grouping = "owner" | "context";

function OwnerLinks({
  entry,
  currentOwner,
}: {
  entry: OwnedService;
  /** The group heading already says this handle, so rows show only co-owners. */
  currentOwner?: string;
}) {
  const owners = ownersOf(entry.service);
  if (owners.length === 0)
    return <span className="text-faint">no declared owner</span>;
  const shown = currentOwner
    ? owners.filter((handle) => handle !== currentOwner)
    : owners;
  // Keep the grid cell even when the group heading already says everything.
  if (shown.length === 0) return <span aria-hidden />;
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
      {shown.map((handle) => (
        <Link
          key={handle}
          to={paths.owner(handle)}
          className="mono truncate rounded-control text-accent hover:underline"
          title={`Show services declared for ${handle}`}
        >
          {handle}
        </Link>
      ))}
    </span>
  );
}

function ServiceRows({
  entries,
  currentOwner,
}: {
  entries: OwnedService[];
  currentOwner?: string;
}) {
  return (
    <div className="ownership-rows rows grid-cols-[minmax(12rem,1fr)_auto_minmax(11rem,1fr)_auto]">
      {entries.map((entry) => (
        <div className="row" key={entry.service.id}>
          <Link
            className="min-w-0 truncate font-medium text-ink hover:text-accent hover:underline"
            to={paths.service(entry.context.id, entry.service.slug)}
            title={entry.service.id}
          >
            {entry.service.name}
          </Link>
          <Link to={paths.context(entry.context.id)}>
            <ContextPill id={entry.context.id} name={entry.context.name} />
          </Link>
          <OwnerLinks entry={entry} currentOwner={currentOwner} />
          <span className="ownership-path mono truncate text-right text-faint" title={entry.service.path}>
            {entry.service.path}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OwnershipPage() {
  useDocumentTitle("Ownership");
  const [params, setParams] = useSearchParams();
  const grouped = useMemo(() => ownershipIndex(catalog), []);
  const selectedOwner = params.get("owner");
  const grouping: Grouping =
    selectedOwner || params.get("by") !== "context" ? "owner" : "context";
  const query = params.get("q") ?? "";
  const needle = query.trim().toLowerCase();

  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const setGrouping = (next: Grouping) => {
    const changed = new URLSearchParams(params);
    if (next === "context") changed.set("by", "context");
    else changed.delete("by");
    changed.delete("owner");
    setParams(changed, { replace: true });
  };
  const matches = (entry: OwnedService) =>
    !needle ||
    `${entry.service.name} ${entry.service.id} ${entry.service.path} ${entry.context.name} ${entry.context.id} ${ownersOf(entry.service).join(" ")}`
      .toLowerCase()
      .includes(needle);

  const ownerGroups = grouped.owners
    .filter(({ handle }) => !selectedOwner || handle === selectedOwner)
    .map((group) => ({ ...group, services: group.services.filter(matches) }))
    .filter(({ services }) => services.length > 0);
  const unassigned = grouped.unassigned.filter(matches);
  const contextGroups = catalog.contexts
    .map((context) => ({
      context,
      services: context.services
        .map((service) => ({ context, service }))
        .filter(matches),
    }))
    .filter(({ services }) => services.length > 0);
  const shown =
    grouping === "context"
      ? contextGroups.reduce((count, group) => count + group.services.length, 0)
      : ownerGroups.reduce((count, group) => count + group.services.length, 0) +
        (selectedOwner ? 0 : unassigned.length);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="max-w-table">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">Ownership</h1>
          <span className="mono text-muted">
            <span className="tnum">{grouped.assigned}</span> of{" "}
            <span className="tnum">{grouped.services.length}</span> services
            declare an owner
          </span>
        </div>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Discovered automatically from repository ownership files, including
          GitHub and GitLab CODEOWNERS. Services with several handles appear
          under every declared owner.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="tbtn gap-1.5 focus-within:border-line-strong">
            <Search size={13} aria-hidden className="shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => set("q", event.target.value)}
              placeholder="filter"
              aria-label="Filter ownership"
              className="mono w-40 bg-transparent text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
          <div className="seg" role="group" aria-label="Group ownership">
            <button
              type="button"
              className={grouping === "owner" ? "is-on" : undefined}
              aria-pressed={grouping === "owner"}
              onClick={() => setGrouping("owner")}
            >
              by owner
            </button>
            <button
              type="button"
              className={grouping === "context" ? "is-on" : undefined}
              aria-pressed={grouping === "context"}
              onClick={() => setGrouping("context")}
            >
              by context
            </button>
          </div>
          <span className="mono text-muted">
            <span className="tnum">{shown}</span>{" "}
            {plural(shown, grouping === "owner" ? "row" : "service")}
          </span>
          {selectedOwner ? (
            <button
              type="button"
              className="mono rounded-control text-accent hover:underline"
              onClick={() => set("owner")}
            >
              all owners
            </button>
          ) : null}
        </div>

        <div className="mt-section space-y-section">
          {grouping === "owner" ? (
            <>
              {ownerGroups.map(({ handle, services }) => (
                <section key={handle} aria-labelledby={`owner-${encodeURIComponent(handle)}`}>
                  <div className="mb-2 flex items-baseline gap-2 border-b border-line pb-1.5">
                    <h2 id={`owner-${encodeURIComponent(handle)}`} className="mono font-semibold text-ink">
                      {handle}
                    </h2>
                    <span className="mono text-muted">
                      <span className="tnum">{services.length}</span>{" "}
                      {plural(services.length, "service")}
                    </span>
                  </div>
                  <ServiceRows entries={services} currentOwner={handle} />
                </section>
              ))}
              {!selectedOwner && unassigned.length > 0 ? (
                <section aria-labelledby="owner-unassigned">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line pb-1.5">
                    <h2 id="owner-unassigned" className="font-semibold text-ink">No declared owner</h2>
                    <span className="mono text-muted">
                      <span className="tnum">{unassigned.length}</span>{" "}
                      {plural(unassigned.length, "service")}
                    </span>
                    <span className="text-sm text-faint">No matching CODEOWNERS evidence was found.</span>
                  </div>
                  <ServiceRows entries={unassigned} />
                </section>
              ) : null}
            </>
          ) : (
            contextGroups.map(({ context, services }) => (
              <section key={context.id} aria-labelledby={`ownership-${context.id}`}>
                <div className="mb-2 flex items-center gap-2 border-b border-line pb-1.5">
                  <h2 id={`ownership-${context.id}`} className="font-semibold text-ink">
                    {context.name}
                  </h2>
                  <span className="mono text-muted">
                    <span className="tnum">{services.length}</span>{" "}
                    {plural(services.length, "service")}
                  </span>
                </div>
                <ServiceRows entries={services} />
              </section>
            ))
          )}
          {shown === 0 ? <Empty>no ownership matches this filter</Empty> : null}
        </div>
      </div>
    </div>
  );
}
