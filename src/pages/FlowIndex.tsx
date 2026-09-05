import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowUpDown, X } from "lucide-react";
import { CATALOG_PATH, catalog } from "../data";
import { allRepos, flowContexts, walkSteps } from "../catalog";
import { FLOW_HEALTH_NOTE, flowHealth, flowOwner, statusCounts } from "../lib/flow-tree";
import type { FlowHealth } from "../lib/flow-tree";
import { statusVar } from "../components/primitives";
import { STATUSES } from "../catalog";
import { sourceHref } from "../lib/source-link";
import { flowRepoService } from "../lib/derive";
import { contextName, contextVar, ctxStyle } from "../lib/context-color";
import { middleTruncate } from "../lib/format";
import { staggerStyle } from "../lib/motion";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { Blank, Empty } from "../components/PageHeader";
import { ContextPill } from "../components/primitives";

type Sort = "contexts" | "name" | "steps" | "health";

const SORTS: { key: Sort; label: string }[] = [
  { key: "contexts", label: "contexts crossed" },
  { key: "steps", label: "steps" },
  { key: "health", label: "status" },
  { key: "name", label: "name" },
];

/** Broken first, proven last: the order of attention. */
const HEALTH_ORDER: Record<FlowHealth, number> = { unresolved: 0, declared: 1, verified: 2 };

const HEALTH_COLOR: Record<FlowHealth, string> = {
  unresolved: "var(--status-unresolved)",
  declared: "var(--fg-faint)",
  verified: "var(--status-verified)",
};

export function FlowIndex() {
  const [sort, setSort] = useState<Sort>("contexts");
  const [active, setActive] = useState<Set<string>>(new Set());
  // `?owner=` is how the sidebar's "view all n" arrives: the reader asked for
  // one context's flows, which is a different question from "flows that touch
  // this context" - the chips below answer that one - so it gets its own line
  // rather than pressing a chip that would mean something else.
  const [params] = useSearchParams();
  const asked = params.get("owner");
  const [owner, setOwner] = useState<string | null>(
    catalog.contexts.some((c) => c.id === asked) ? asked : null,
  );

  const rows = useMemo(() => {
    const built = catalog.flows
      .filter((flow) => owner === null || flowOwner(flow) === owner)
      .map((flow) => ({
        flow,
        contexts: flowContexts(flow),
        steps: walkSteps(flow.steps).length,
        health: flowHealth(flow),
        counts: statusCounts(flow),
      }));
    const filtered =
      active.size === 0
        ? built
        : built.filter((r) => r.contexts.some((c) => active.has(c)));
    // Every comparator falls through to the name, so the order is total and
    // the grid does not reshuffle between renders.
    const sorted = [...filtered];
    if (sort === "name") {
      sorted.sort((a, b) => a.flow.name.localeCompare(b.flow.name));
    } else if (sort === "steps") {
      sorted.sort(
        (a, b) => b.steps - a.steps || a.flow.name.localeCompare(b.flow.name),
      );
    } else if (sort === "health") {
      sorted.sort(
        (a, b) =>
          HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
          a.flow.name.localeCompare(b.flow.name),
      );
    } else {
      sorted.sort(
        (a, b) =>
          b.contexts.length - a.contexts.length ||
          a.flow.name.localeCompare(b.flow.name),
      );
    }
    return sorted;
  }, [sort, active, owner]);

  const toggleContext = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Nothing to filter and nothing to sort: on a first catalog the controls
  // outnumber the rows, and a segmented control over an empty list reads as a
  // page that has broken rather than one that has not been filled yet.
  const bare = catalog.flows.length === 0;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Flows</h1>
        {bare ? null : (
          <span className="mono text-muted">
            {rows.length} of {catalog.flows.length}
          </span>
        )}

        <div
          className="ml-auto flex flex-wrap items-center gap-2"
          hidden={bare}
        >
          {/* One filter over one list, so one border round it. A pressed
              member keeps its own context colour - that is the thing being
              filtered, and it must not collapse into a single accent. */}
          <div className="seg" role="group" aria-label="Filter by context">
            {catalog.contexts.map((c) => {
              const on = active.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleContext(c.id)}
                  aria-pressed={on}
                  className="flex items-center gap-1.5"
                  style={{
                    color: on ? contextVar(c.id) : "var(--fg-muted)",
                    background: on
                      ? `color-mix(in srgb, ${contextVar(c.id)} 12%, transparent)`
                      : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-[1px]"
                    style={{ background: contextVar(c.id) }}
                  />
                  {c.id}
                </button>
              );
            })}
          </div>

          <div className="seg" role="group" aria-label="Sort flows">
            <span className="flex items-center px-2 py-1">
              <ArrowUpDown size={14} aria-hidden className="text-muted" />
            </span>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={sort === s.key ? "is-on" : ""}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {owner ? (
        <div className="mono mt-3 flex items-center gap-2 text-muted">
          <span>
            owned by{" "}
            <span className="ctx" style={ctxStyle(owner)}>
              {contextName(owner)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setOwner(null)}
            title="Show every flow again"
            className="flex items-center gap-1 rounded-control text-accent hover:underline"
          >
            <X size={12} aria-hidden />
            show all
          </button>
        </div>
      ) : null}

      {bare ? (
        <div className="mt-section">
          <Blank where={CATALOG_PATH}>
            No flows yet — a flow is one run across the estate, reconstructed
            from an integration test or written down by hand. Either way it
            arrives in <span className="text-ink">flows[]</span>.
          </Blank>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-section">
          <Empty>no flow crosses every context you have picked</Empty>
        </div>
      ) : (
        <div
          className="mt-section grid gap-grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))]"
          data-nav-list
        >
          {rows.map(({ flow, contexts, steps, health, counts }, i) => {
            const source = flow.source
              ? sourceHref(flow.source, flowRepoService(catalog, flow), allRepos(catalog))
              : null;
            return (
              <div
                key={flow.slug}
                className="card stagger-in"
                style={{
                  ...staggerStyle(i),
                  borderLeftWidth: 3,
                }}
              >
                <div className="flex items-baseline gap-2">
                  <Link
                    to={`/flows/${flow.slug}`}
                    data-nav-item
                    className="card-link rounded-control font-semibold"
                    title={flow.name}
                  >
                    {flow.name}
                  </Link>
                  <Ident value={flow.id} className="text-muted">
                    {flow.slug}
                  </Ident>
                  <RowActions copy={flow.id} label={flow.name} />
                  {/* How far the flow can be believed, as one dot and the
                      counts behind it: a card has room for both, and the
                      dot alone is the sidebar's answer. */}
                  <span
                    className="mono ml-auto flex shrink-0 items-center gap-1.5 text-muted"
                    title={FLOW_HEALTH_NOTE[health]}
                  >
                    <span
                      aria-hidden
                      className="size-2 rounded-[2px]"
                      style={{ background: HEALTH_COLOR[health] }}
                    />
                    {STATUSES.filter((status) => counts[status] > 0).map((status) => (
                      <span key={status} className="flex items-center gap-0.5" title={status}>
                        <span
                          aria-hidden
                          className="size-1.5 rounded-[1px]"
                          style={{ background: statusVar(status) }}
                        />
                        <span className="tnum">{counts[status]}</span>
                      </span>
                    ))}
                  </span>
                </div>

                <p className="mt-2 line-clamp-2 text-muted">{flow.summary}</p>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {contexts.map((c) => (
                    <ContextPill key={c} id={c} name={contextName(c)} />
                  ))}
                  {/* The count opens the sequence it counted. */}
                  <Link
                    to={`/flows/${flow.slug}`}
                    className="mono ml-auto rounded-control text-muted hover:text-ink"
                    title="open the step list"
                  >
                    <span className="tnum">{steps}</span> steps
                  </Link>
                </div>

                {/* The file it was read out of. Every flow here is derived the
                    same way, so the only thing worth printing is WHICH source
                    said so. */}
                {flow.source ? (
                  <div className="mt-4 flex items-center gap-2">
                    <Ident value={flow.source} className="text-muted">
                      {middleTruncate(flow.source, 44)}
                    </Ident>
                    {source ? (
                      <a
                        href={source}
                        target="_blank"
                        rel="noreferrer"
                        className="mono rounded-control text-accent hover:underline"
                        title="Open the file on the forge, at the built commit"
                      >
                        open ↗
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
