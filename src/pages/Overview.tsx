import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { CATALOG_PATH, catalog } from "../data";
import { contextStats, flowsByReach } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { useCountUp, staggerStyle } from "../lib/motion";
import { CONTEXT_ANCHOR, OVERVIEW_ANCHOR, paths } from "../routes";
import { Blank, SectionTitle } from "../components/PageHeader";
import { Ident } from "../components/Ident";
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

export function Overview() {
  const reach = flowsByReach(catalog);

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-lg font-semibold">portolan</h1>
        <span className="text-muted">
          the chart is drawn from measurements; the code is the territory
        </span>
        {/* The catalog's own provenance, not the app's: the top bar carries
            the build this bundle came from. */}
        <span
          className="mono ml-auto text-muted"
          title={`catalog generated ${absoluteTime(catalog.generatedAt)} from commit ${catalog.commit}`}
        >
          catalog {catalog.commit} · {relativeTime(catalog.generatedAt)}
        </span>
      </div>

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
                className="card card-tagged stagger-in"
                style={{ ...staggerStyle(i), ...ctxStyle(context.id) }}
              >
                {/* Wraps: with a name, an id, the row actions and up to two
                    chips on one line, a 300px card runs out of room before the
                    grid does, and an unwrapped row would push the whole column
                    wider than its track. */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    to={paths.context(context.id)}
                    data-nav-item
                    className="card-link rounded-control font-semibold"
                    title={context.name}
                  >
                    {context.name}
                  </Link>
                  <Ident
                    value={context.id}
                    className="ctx"
                    style={ctxStyle(context.id)}
                  />
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
                <div className="mono mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 whitespace-nowrap text-muted">
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
            reach.length > 0 ? (
              <Link
                to={paths.flows()}
                className="rounded-control px-1 text-accent hover:underline"
              >
                all flows →
              </Link>
            ) : null
          }
        >
          Flows by reach
        </SectionTitle>
        {reach.length === 0 ? (
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
