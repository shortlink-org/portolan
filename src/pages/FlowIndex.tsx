import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUpDown } from "lucide-react";
import { catalog } from "../data";
import { flowContexts, walkSteps } from "../catalog";
import { contextName, contextVar } from "../lib/context-color";
import { staggerStyle } from "../lib/motion";
import { Ident } from "../components/Ident";
import { RowActions } from "../components/RowActions";
import { Empty } from "../components/PageHeader";
import { ContextPill, ProvenanceBadge } from "../components/primitives";

type Sort = "contexts" | "name" | "steps";

const SORTS: { key: Sort; label: string }[] = [
  { key: "contexts", label: "contexts crossed" },
  { key: "steps", label: "steps" },
  { key: "name", label: "name" },
];

export function FlowIndex() {
  const [sort, setSort] = useState<Sort>("contexts");
  const [active, setActive] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const built = catalog.flows.map((flow) => ({
      flow,
      contexts: flowContexts(flow),
      steps: walkSteps(flow.steps).length,
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
    } else {
      sorted.sort(
        (a, b) =>
          b.contexts.length - a.contexts.length ||
          a.flow.name.localeCompare(b.flow.name),
      );
    }
    return sorted;
  }, [sort, active]);

  const toggleContext = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Flows</h1>
        <span className="mono text-muted">
          {rows.length} of {catalog.flows.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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

      {rows.length === 0 ? (
        <div className="mt-section">
          <Empty>no flow crosses every context you have picked</Empty>
        </div>
      ) : (
        <div
          className="mt-section grid gap-grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))]"
          data-nav-list
        >
          {rows.map(({ flow, contexts, steps }, i) => {
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

                <div className="mt-4">
                  <ProvenanceBadge
                    provenance={flow.provenance}
                    source={flow.source}
                    verifiedAt={flow.verifiedAt}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
