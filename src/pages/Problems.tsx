// Everywhere the chart draws an arrow into open water.
//
// There is no score and no severity column. An edge either lands somewhere the
// catalog knows about or it does not, and the only useful ordering is the one
// the reader can act on: by the service that owns the near end.

import { useDocumentTitle } from "../app/title";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { catalog, index } from "../data";
import { edgeCount } from "../lib/derive";
import { allProblems } from "../lib/all-problems";
import { contextVar } from "../lib/context-color";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { SectionTitle } from "../components/PageHeader";
import { ProblemRow } from "../components/ProblemRow";
import { CatEmptyState } from "../components/CatIllustration";

export function Problems() {
  useDocumentTitle("Problems");
  // `?context=` is how the sidebar's unresolved-edge count arrives here: the
  // reader clicked a number against one context, so that context is what the
  // page opens filtered to. It seeds the chips rather than replacing them -
  // once here, the filter is theirs to widen.
  const [params] = useSearchParams();
  const [active, setActive] = useState<Set<string>>(
    () =>
      new Set(
        params
          .getAll("context")
          .filter((id) => catalog.contexts.some((c) => c.id === id)),
      ),
  );
  // Unresolved edges first, then everything the schema disagrees with. Within
  // each, errors before warnings: a boundary leak is not the same kind of news
  // as a column whose type has drifted, and mixing them buries the first.
  const all = useMemo(() => allProblems(catalog, index), []);
  // How many edges there were to resolve at all. Zero problems out of zero
  // edges is not a clean bill of health - nothing crossed a boundary, so
  // nothing was checked, and saying "every edge resolved" there is a green
  // tick the catalog has not earned.
  const edges = useMemo(() => edgeCount(catalog), []);
  const rows = useMemo(
    () => (active.size === 0 ? all : all.filter((p) => active.has(p.context))),
    [all, active],
  );

  const toggle = (id: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const countIn = (contextId: string) =>
    all.filter((p) => p.context === contextId).length;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Problems</h1>
        {/* "0 of 0" is a ratio of nothing to nothing; the line below says it
            in words. */}
        {all.length > 0 ? (
          <span className="mono text-muted">
            {rows.length} of {all.length}
          </span>
        ) : null}
        {/* Two counts, not a score. A reader triaging this page decides what
            to open by which half it is in. */}
        {all.length > 0 ? (
          <span className="mono flex items-center gap-3">
            <span className="text-unresolved">
              <span className="tnum">
                {all.filter((p) => p.severity === "error").length}
              </span>{" "}
              {plural(
                all.filter((p) => p.severity === "error").length,
                "error",
              )}
            </span>
            <span className="text-declared">
              <span className="tnum">
                {all.filter((p) => p.severity === "warning").length}
              </span>{" "}
              {plural(
                all.filter((p) => p.severity === "warning").length,
                "warning",
              )}
            </span>
          </span>
        ) : null}

        {all.length > 0 ? (
          <div
            className="seg ml-auto"
            role="group"
            aria-label="Filter by context"
          >
            {catalog.contexts
              .filter((c) => countIn(c.id) > 0)
              .map((c) => {
                const on = active.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
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
                    <span className="tnum">{countIn(c.id)}</span>
                  </button>
                );
              })}
          </div>
        ) : null}
      </div>

      {all.length === 0 ? (
        <ClearSkies checked={edges} />
      ) : (
        <div className="mt-section max-w-table">
          <SectionTitle
            right={
              <span title={absoluteTime(catalog.generatedAt)}>
                last checked {relativeTime(catalog.generatedAt)}
              </span>
            }
          >
            Everything that does not line up
          </SectionTitle>
          <div className="flex flex-col gap-1" data-nav-list>
            {rows.map((problem, i) => (
              <ProblemRow
                key={`${problem.kind}:${problem.id}:${problem.peer}`}
                problem={problem}
                index={i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The one line the reader wants to see. Nothing else earns the space. */
function ClearSkies({ checked }: { checked: number }) {
  return (
    <CatEmptyState
      scene="clear"
      title={checked === 0 ? "Nothing to resolve yet" : "Clear skies"}
      className="mt-section max-w-prose"
      meta={<span title={absoluteTime(catalog.generatedAt)}>last checked {relativeTime(catalog.generatedAt)}</span>}
    >
      {checked === 0
        ? "No service calls another, and no event has a consumer."
        : `All ${checked} ${plural(checked, "edge")} resolved.`}
    </CatEmptyState>
  );
}
