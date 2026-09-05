import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { CATALOG_PATH, catalog, index } from "../data";
import { contextStats, problems, widestFlows } from "../lib/derive";
import { dataProblems } from "../lib/data-problems";
import { protoProblems } from "../lib/proto-problems";
import { wireProblems } from "../lib/wire-problems";
import { ctxStyle } from "../lib/context-color";
import { plural } from "../lib/format";
import { useCountUp, staggerStyle } from "../lib/motion";
import { usePhone } from "../app/responsive";
import { CONTEXT_ANCHOR, OVERVIEW_ANCHOR, paths } from "../routes";
import { Blank, SectionTitle } from "../components/PageHeader";
import { C4View } from "../likec4/C4View";
import { LANDSCAPE_VIEW } from "../likec4/ids";
import { LevelBadge } from "../likec4/levels";
import { CatalogStamp } from "../components/CatalogStamp";
import { RowActions } from "../components/RowActions";
import {
  ClassificationBadge,
  ContextPill,
} from "../components/primitives";

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

export function Overview() {
  const phone = usePhone();
  const reach = widestFlows(catalog);
  const services = catalog.contexts.reduce(
    (count, context) => count + context.services.length,
    0,
  );
  const issueCount = [
    ...problems(catalog),
    ...protoProblems(catalog, index),
    ...dataProblems(catalog, index),
    ...wireProblems(catalog, index),
  ].length;

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
          to={paths.problems()}
          problem
        />
      </div>

      {/* C4 level 1, and the only picture in the app that draws the whole
          estate as boxes: the contexts, the people who use them, the systems
          they pay and ask, and the consumers nothing in the catalog accounts
          for. The event graph at /graph is a different question — which event
          reaches whom — and it is drawn by a different renderer. */}
      <section id={OVERVIEW_ANCHOR.landscape} className="mt-section">
        <SectionTitle
          anchor={OVERVIEW_ANCHOR.landscape}
          right={<LevelBadge level={1} />}
        >
          Landscape
        </SectionTitle>
        <C4View
          viewId={LANDSCAPE_VIEW}
          height={phone ? 300 : 400}
          controls={phone}
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
            return (
              <div
                key={context.id}
                /* A subgrid of the row it sits in: the title, the summary and
                   the counts each take one track, so the counts stand on the
                   same line in every card of a row instead of hanging under
                   each summary's own last sentence. The inner gap is zeroed
                   because a subgrid inherits the grid's, and the margins on
                   the rows already say how far apart they sit. */
                className="card card-tagged stagger-in grid grid-rows-subgrid row-span-3 gap-y-0"
                style={{ ...staggerStyle(i), ...ctxStyle(context.id) }}
              >
                {/* Wraps: with a name, the row actions and up to two chips on
                    one line, a 300px card runs out of room before the grid
                    does, and an unwrapped row would push the whole column
                    wider than its track. The id is not shown next to the name:
                    "Authentication auth" says one thing twice, and the copy
                    action already carries it. */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    to={paths.context(context.id)}
                    data-nav-item
                    className="card-link rounded-control font-semibold"
                    title={context.name}
                  >
                    {context.name}
                  </Link>
                  {/* The actions ride on the title row, where there is room
                      for them: on the counts row they squeeze three links
                      into two lines each. */}
                  <RowActions
                    copy={context.id}
                    reveal={context.id}
                    label={context.name}
                  />
                  <span className="ml-auto flex items-center gap-2">
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
                  </span>
                </div>
                <p className="mt-2 text-muted">{context.summary}</p>
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
    </div>
  );
}
