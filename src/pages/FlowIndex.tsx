import { useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowUpDown } from "lucide-react";
import { catalog } from "../data";
import {
  coverageRatio,
  flowContexts,
  flowCoverage,
  walkSteps,
} from "../catalog";
import { contextName, contextVar } from "../lib/context-color";
import {
  ContextPill,
  CoverageBar,
  ProvenanceBadge,
} from "../components/primitives";

type Sort = "coverage" | "name" | "contexts";

const SORTS: { key: Sort; label: string }[] = [
  { key: "coverage", label: "coverage ↑" },
  { key: "name", label: "name" },
  { key: "contexts", label: "contexts crossed" },
];

export function FlowIndex() {
  const [sort, setSort] = useState<Sort>("coverage");
  const [active, setActive] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const built = catalog.flows.map((flow) => ({
      flow,
      coverage: flowCoverage(flow),
      contexts: flowContexts(flow),
      steps: walkSteps(flow.steps).length,
    }));
    const filtered =
      active.size === 0
        ? built
        : built.filter((r) => r.contexts.some((c) => active.has(c)));
    const sorted = [...filtered];
    if (sort === "coverage") {
      sorted.sort(
        (a, b) =>
          coverageRatio(a.coverage) - coverageRatio(b.coverage) ||
          a.flow.name.localeCompare(b.flow.name),
      );
    } else if (sort === "name") {
      sorted.sort((a, b) => a.flow.name.localeCompare(b.flow.name));
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
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[15px] font-semibold">Flows</h1>
        <span className="mono text-muted">
          {rows.length} of {catalog.flows.length}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {catalog.contexts.map((c) => {
              const on = active.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleContext(c.id)}
                  aria-pressed={on}
                  className="mono flex items-center gap-1 border px-1.5 py-0.5"
                  style={{
                    borderColor: on ? contextVar(c.id) : "var(--border)",
                    color: on ? contextVar(c.id) : "var(--fg-muted)",
                    background: on
                      ? `color-mix(in srgb, ${contextVar(c.id)} 12%, transparent)`
                      : undefined,
                  }}
                >
                  <span
                    aria-hidden
                    className="size-1.5"
                    style={{ background: contextVar(c.id) }}
                  />
                  {c.id}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 border px-1.5 py-0.5 border-line">
            <ArrowUpDown size={11} aria-hidden className="text-muted" />
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSort(s.key)}
                aria-pressed={sort === s.key}
                className={`mono px-1 ${sort === s.key ? "text-ink" : "text-muted"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
        {rows.map(({ flow, coverage, contexts, steps }) => {
          const broken = coverage.unresolved > 0;
          return (
            <Link
              key={flow.slug}
              to={`/flows/${flow.slug}`}
              className="card"
              style={{
                borderColor: broken
                  ? "var(--status-unresolved)"
                  : "var(--border)",
                borderLeftWidth: broken ? 3 : 1,
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{flow.name}</span>
                <span className="mono text-muted">{flow.slug}</span>
                {broken ? (
                  <span className="mono ml-auto flex items-center gap-1 text-unresolved">
                    <AlertTriangle size={11} aria-hidden />
                    {coverage.unresolved} unresolved
                  </span>
                ) : null}
              </div>

              <p className="mt-1 line-clamp-2 text-muted">{flow.summary}</p>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {contexts.map((c) => (
                  <ContextPill key={c} id={c} name={contextName(c)} />
                ))}
                <span className="mono ml-auto text-muted">{steps} steps</span>
              </div>

              <div className="mt-2">
                <CoverageBar coverage={coverage} />
              </div>

              <div className="mt-2">
                <ProvenanceBadge
                  provenance={flow.provenance}
                  source={flow.source}
                  verifiedAt={flow.verifiedAt}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
