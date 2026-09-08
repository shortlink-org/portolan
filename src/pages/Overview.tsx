import { useDocumentTitle } from "../app/title";
import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { activeCatalogProfile, CATALOG_PATH, catalog, index } from "../data";
import { contextOwners, contextStats, widestFlows } from "../lib/derive";
import type { ContextOwner } from "../lib/derive";
import { allProblems } from "../lib/all-problems";
import { ctxStyle } from "../lib/context-color";
import { middleTruncate, plural } from "../lib/format";
import { useCountUp, staggerStyle } from "../lib/motion";
import { usePhone } from "../app/responsive";
import { CONTEXT_ANCHOR, OVERVIEW_ANCHOR, paths } from "../routes";
import { Blank, SectionTitle } from "../components/PageHeader";
import { C4View } from "../likec4/C4View";
import { profileContainersViewId, profileLandscapeViewId } from "../likec4/ids";
import { LevelSwitch } from "../likec4/levels";
import type { C4Level } from "../likec4/levels";
import { CatalogStamp } from "../components/CatalogStamp";
import { ProblemRow } from "../components/ProblemRow";
import { RowActions } from "../components/RowActions";
import { MachineDocs } from "../components/MachineDocs";
import {
  ClassificationBadge,
  ContextPill,
} from "../components/primitives";

/** How many problems the overview lists before pointing at the page that lists them all. */
const OVERVIEW_PROBLEMS = 4;

/**
 * A measurement that arrives rather than appears - 200ms, linear, once - and
 * then takes you to what it measured. A number that counts something the app
 * can show and does not link to it is a dead end wearing a fact's clothes.
 */
function Count({
  value,
  unit,
  to,
}: {
  value: number;
  /** Singular. A first catalog is mostly ones, and "1 services" reads wrong. */
  unit: string;
  to: string;
}) {
  const shown = useCountUp(value);
  return (
    <Link to={to} className="rounded-control hover:text-ink">
      <span className="tnum">{shown}</span> {plural(value, unit)}
    </Link>
  );
}

function HealthMetric({
  value,
  unit,
  to,
  problem = false,
}: {
  value: number;
  unit: string;
  to: string;
  problem?: boolean;
}) {
  const shown = useCountUp(value);
  return (
    <Link
      to={to}
      className="group flex min-w-0 items-baseline gap-2 rounded-card border border-line bg-canvas px-3 py-2 shadow-xs transition-colors hover:bg-surface hover:border-line-strong"
      title={`Open ${plural(value, unit)}`}
    >
      <span
        className={`tnum text-lg font-semibold ${problem && value > 0 ? "text-unresolved" : "text-ink"}`}
      >
        {shown}
      </span>
      <span className="mono truncate text-muted group-hover:text-ink">
        {plural(value, unit)}
      </span>
    </Link>
  );
}

/**
 * The tooltip behind a context's owners: each handle with the services it
 * stands behind, so "who to ask" also says what about.
 */
function askTitle(owners: readonly ContextOwner[]): string | undefined {
  if (owners.length === 0) return undefined;
  return `Who to ask: ${owners
    .map((o) => `${o.handle} (${o.services.map((s) => s.slug).join(", ")})`)
    .join("; ")}`;
}

export function Overview() {
  useDocumentTitle("Overview");
  const phone = usePhone();
  const [level, setLevel] = useState<C4Level>(1);
  const reach = widestFlows(catalog);
  const services = catalog.contexts.reduce(
    (count, context) => count + context.services.length,
    0,
  );
  const issues = allProblems(catalog, index);
  const issueCount = issues.length;
  const errorCount = issues.filter((p) => p.severity === "error").length;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-start sm:gap-x-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Architecture overview</h1>
          <p className="text-muted">
            the chart is drawn from measurements; the code is the territory
          </p>
        </div>
        {/* The catalog's own provenance, not the app's: the top bar carries
            the build this bundle came from. It opens, because the stamp is a
            summary of many stamps and the reader who doubts it wants the
            parts. */}
        <CatalogStamp />
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-grid sm:grid-cols-4"
        aria-label="Catalog health"
      >
        <HealthMetric
          value={catalog.contexts.length}
          unit="context"
          to={`#${OVERVIEW_ANCHOR.contexts}`}
        />
        <HealthMetric
          value={services}
          unit="service"
          to={`#${OVERVIEW_ANCHOR.contexts}`}
        />
        <HealthMetric
          value={catalog.flows.length}
          unit="flow"
          to={paths.flows()}
        />
        <HealthMetric
          value={issueCount}
          unit="problem"
          to={issueCount > 0 ? `#${OVERVIEW_ANCHOR.problems}` : paths.problems()}
          problem
        />
      </div>

      {/* The whole estate as boxes, at two scopes. Level 1 is the contexts,
          the people who use them, the systems they pay and ask, and the
          consumers nothing in the catalog accounts for. Level 2 opens the
          contexts: every service with its technology, the store it keeps
          its state in, the brokers between them, and the protocol on each
          edge. The event graph at /graph is a different question — which
          event reaches whom — and it is drawn by a different renderer. */}
      <section id={OVERVIEW_ANCHOR.landscape} className="mt-section">
        <SectionTitle
          anchor={OVERVIEW_ANCHOR.landscape}
          right={
            <LevelSwitch
              level={level}
              onLevel={setLevel}
              levels={[
                { level: 1, label: "estate" },
                { level: 2, label: "containers" },
              ]}
            />
          }
        >
          Landscape
        </SectionTitle>
        <C4View
          viewId={
            level === 2
              ? profileContainersViewId(activeCatalogProfile.id)
              : profileLandscapeViewId(activeCatalogProfile.id)
          }
          height={phone ? 320 : level === 2 ? 660 : 580}
          controls={phone}
          fitViewPadding={{ x: 8, y: 8 }}
        />
      </section>

      <section id={OVERVIEW_ANCHOR.contexts} className="mt-section">
        <SectionTitle anchor={OVERVIEW_ANCHOR.contexts}>Contexts</SectionTitle>
        <div
          className="grid gap-grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
          data-nav-list
        >
          {catalog.contexts.map((context, i) => {
            const stats = contextStats(context);
            const owners = contextOwners(context);
            return (
              <div
                key={context.id}
                /* A subgrid of the row it sits in: the name, the chips, the
                   summary and the counts each take one track, so the same
                   line stands at the same height in every card of a row
                   instead of hanging under each card's own previous line.
                   The inner gap is zeroed because a subgrid inherits the
                   grid's, and the margins on the rows already say how far
                   apart they sit. */
                className="card card-tagged stagger-in grid grid-rows-subgrid row-span-5 gap-y-0"
                style={{ ...staggerStyle(i), ...ctxStyle(context.id) }}
              >
                {/* The name and its actions, alone on the first line. With the
                    chips on the same line the row wrapped in some cards and
                    not in others, and the copy button landed wherever the
                    wrap left it. The id is not shown next to the name:
                    "Authentication auth" says one thing twice, and the copy
                    action already carries it. */}
                <div className="flex items-baseline gap-x-2">
                  <Link
                    to={paths.context(context.id)}
                    data-nav-item
                    className="card-link min-w-0 rounded-control font-semibold"
                    title={context.name}
                  >
                    {context.name}
                  </Link>
                  <RowActions
                    copy={context.id}
                    reveal={context.id}
                    label={context.name}
                  />
                </div>
                {/* The classification and the problem count, on their own
                    line under the name, at the same height in every card and
                    on the right, under the actions, so the left edge is the
                    name's and the summary's alone. */}
                <div className="mt-1.5 flex flex-wrap items-center justify-end gap-2">
                  <ClassificationBadge
                    classification={context.classification}
                  />
                  {stats.unresolved > 0 ? (
                    <Link
                      to={paths.problems()}
                      className="chip status-unresolved"
                      title="unresolved rpc calls and unresolved event consumers — open Problems"
                    >
                      <AlertTriangle size={12} aria-hidden />
                      {stats.unresolved}
                    </Link>
                  ) : null}
                </div>
                <p className="mt-2 text-muted">{context.summary}</p>
                {/* Who to ask, folded up from the services' CODEOWNERS. The
                    row is there in every card of the row, empty where no
                    service named anybody, so the counts still line up. */}
                <div className="mono trunc mt-2 text-muted" title={askTitle(owners)}>
                  {owners.length > 0 ? middleTruncate(owners.map((o) => o.handle).join(" · ")) : null}
                </div>
                <div className="mono mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 self-end whitespace-nowrap text-muted">
                  <Count
                    value={stats.services}
                    unit="service"
                    to={`${paths.context(context.id)}#${CONTEXT_ANCHOR.services}`}
                  />
                  <Count
                    value={stats.aggregates}
                    unit="aggregate"
                    to={`${paths.context(context.id)}#${CONTEXT_ANCHOR.aggregates}`}
                  />
                  <Count
                    value={stats.events}
                    unit="event"
                    to={`${paths.context(context.id)}#${CONTEXT_ANCHOR.events}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id={OVERVIEW_ANCHOR.flows} className="mt-section">
        <SectionTitle
          anchor={OVERVIEW_ANCHOR.flows}
          right={
            /* With no flows the link leads to a page that says the same thing
               again, which is how a first catalog teaches a reader that this
               app is full of dead ends. */
            catalog.flows.length > 0 ? (
              <span className="flex items-center gap-2">
                {catalog.flows.length > reach.length ? (
                  <span className="section-aside">
                    {reach.length} of {catalog.flows.length}
                  </span>
                ) : null}
                <Link
                  to={paths.flows()}
                  className="rounded-control px-1 text-accent hover:underline"
                >
                  all flows →
                </Link>
              </span>
            ) : null
          }
        >
          Flows by reach
        </SectionTitle>
        {catalog.flows.length === 0 ? (
          <Blank where={CATALOG_PATH}>
            No flows yet — a flow is one run across the estate, reconstructed
            from an integration test or written down by hand. Either way it
            arrives in <span className="text-ink">flows[]</span>.
          </Blank>
        ) : null}
        <div className="flex flex-col gap-2" data-nav-list>
          {reach.map(({ flow, contexts }, i) => {
            return (
              <Link
                key={flow.slug}
                to={paths.flow(flow.slug)}
                data-nav-item
                className="row stagger-in flex-wrap"
                style={staggerStyle(i)}
              >
                <span
                  className="mono w-6 shrink-0 text-right text-muted"
                  title={`${contexts.length} contexts crossed`}
                >
                  {contexts.length}×
                </span>
                <span className="font-semibold" title={flow.name}>
                  {flow.name}
                </span>
                <div className="flex flex-wrap gap-1">
                  {contexts.map((c) => (
                    <ContextPill key={c} id={c} />
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* The first few problems, errors first, on the page a reader lands on.
          The count in the health row says how many; this says which, so
          "13 problems" is a list to start on rather than a number to worry
          about. Nothing is shown for a clean estate - the metric already
          says zero, and a heading over an empty list is a dead end. */}
      {issueCount > 0 ? (
        <section id={OVERVIEW_ANCHOR.problems} className="mt-section">
          <SectionTitle
            anchor={OVERVIEW_ANCHOR.problems}
            right={
              <span className="flex items-center gap-2">
                <span className="section-aside">
                  <span className="text-unresolved">
                    {errorCount} {plural(errorCount, "error")}
                  </span>
                  {issueCount - errorCount > 0 ? (
                    <>
                      {" · "}
                      <span className="text-declared">
                        {issueCount - errorCount}{" "}
                        {plural(issueCount - errorCount, "warning")}
                      </span>
                    </>
                  ) : null}
                </span>
                <Link
                  to={paths.problems()}
                  className="rounded-control px-1 text-accent hover:underline"
                >
                  all problems →
                </Link>
              </span>
            }
          >
            Problems
          </SectionTitle>
          <div className="flex max-w-table flex-col gap-2" data-nav-list>
            {issues.slice(0, OVERVIEW_PROBLEMS).map((problem, i) => (
              <ProblemRow
                key={`${problem.kind}:${problem.id}:${problem.peer}`}
                problem={problem}
                index={i}
              />
            ))}
            {issueCount > OVERVIEW_PROBLEMS ? (
              <Link
                to={paths.problems()}
                className="mono self-start rounded-control px-1 text-muted hover:text-ink"
              >
                {issueCount - OVERVIEW_PROBLEMS} more →
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <MachineDocs className="mt-section pb-section" />
    </div>
  );
}
