import { Fragment } from "react";
import { Link, useLocation } from "react-router";
import { ChevronRight } from "lucide-react";
import { catalog, index } from "../data";
import { adrNumber } from "../lib/adr";
import { selectionLabel, selectionTrail } from "../selection/model";
import { selectionPath } from "../selection/pages";
import { useSelectionStore } from "../selection/store";
import { paths } from "../routes";

interface Crumb {
  label: string;
  to: string;
}

function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  if (parts[0] === "flows") {
    const crumbs: Crumb[] = [{ label: "flows", to: "/flows" }];
    const slug = parts[1];
    if (slug) {
      const flow = index.flowBySlug.get(slug);
      crumbs.push({ label: flow?.slug ?? slug, to: `/flows/${slug}` });
    }
    return crumbs;
  }

  if (parts[0] === "adrs") {
    const crumbs: Crumb[] = [{ label: "adrs", to: "/adrs" }];
    const slug = parts[1];
    if (slug) {
      const adr = index.adrBySlug.get(slug);
      crumbs.push({
        label: adr ? adrNumber(adr) : slug,
        to: `/adrs/${slug}`,
      });
    }
    return crumbs;
  }

  if (parts[0] === "graph") return [{ label: "graph", to: "/graph" }];

  if (parts[0] === "map") return [{ label: "map", to: "/map" }];

  if (parts[0] === "settings")
    return [{ label: "settings", to: paths.settings() }];

  if (parts[0] === "changes")
    return [{ label: "changes", to: paths.changes() }];

  if (parts[0] === "c") {
    const [, contextId, serviceSlug, aggregateSlug, eventSlug] = parts;
    const crumbs: Crumb[] = [];
    if (!contextId) return crumbs;
    crumbs.push({ label: contextId, to: `/c/${contextId}` });
    if (!serviceSlug) return crumbs;
    crumbs.push({ label: serviceSlug, to: `/c/${contextId}/${serviceSlug}` });
    if (!aggregateSlug) return crumbs;
    crumbs.push({
      label: aggregateSlug,
      to: `/c/${contextId}/${serviceSlug}/${aggregateSlug}`,
    });
    if (!eventSlug) return crumbs;
    const aggregate = catalog.contexts
      .find((c) => c.id === contextId)
      ?.services.find((s) => s.slug === serviceSlug)
      ?.aggregates.find((a) => a.slug === aggregateSlug);

    // "vo" and "entity" are literals, not slugs: one more segment follows.
    if (eventSlug === "vo" || eventSlug === "entity") {
      const blockSlug = parts[5];
      if (!blockSlug) return crumbs;
      const list =
        eventSlug === "vo" ? aggregate?.valueObjects : aggregate?.entities;
      const block = list?.find((b) => b.slug === blockSlug);
      crumbs.push({
        label: block?.name ?? blockSlug,
        to: `/c/${contextId}/${serviceSlug}/${aggregateSlug}/${eventSlug}/${blockSlug}`,
      });
      return crumbs;
    }

    const event = aggregate?.events.find((e) => e.slug === eventSlug);
    crumbs.push({
      label: event?.name ?? eventSlug,
      to: `/c/${contextId}/${serviceSlug}/${aggregateSlug}/${eventSlug}`,
    });
    return crumbs;
  }

  return [];
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname);

  const selection = useSelectionStore((s) => s.selection);
  const select = useSelectionStore((s) => s.select);

  // The route says where the reader is; the selection says what they are
  // looking at, and the two are often not the same thing - an event picked
  // while a flow is open, say. The selection trail is appended rather than
  // substituted so neither answer is lost.
  const alreadyOnRoute =
    selection !== null &&
    selection.kind !== "flow-step" &&
    selectionPath(selection) === pathname;
  // Only the part of the trail the route does not already say. Repeating
  // "shop > oms" either side of the marker is noise, not information.
  const onRoute = new Set(crumbs.map((c) => c.to));
  const full = selection && !alreadyOnRoute ? selectionTrail(selection) : [];
  const trail = full.filter(
    (step) =>
      step.kind === "flow-step" || !onRoute.has(selectionPath(step) ?? ""),
  );

  return (
    <div className="mono flex min-w-0 items-center gap-1 truncate">
      <Link to="/" className="hover:underline text-muted">
        portolan
      </Link>
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.to}>
          <ChevronRight size={11} aria-hidden className="text-line-strong" />
          <Link
            to={crumb.to}
            className={`truncate hover:underline ${i === crumbs.length - 1 && trail.length === 0 ? "text-ink" : "text-muted"}`}
          >
            {crumb.label}
          </Link>
        </Fragment>
      ))}

      {trail.length > 0 ? (
        <>
          <span
            aria-hidden
            title="selected"
            className="mx-1 size-1.5 shrink-0"
            style={{ background: "var(--accent)" }}
          />
          {trail.map((step, i) => (
            <Fragment key={step.id}>
              {i > 0 ? (
                <ChevronRight
                  size={11}
                  aria-hidden
                  className="text-line-strong"
                />
              ) : null}
              <button
                type="button"
                onClick={() => select(step.id, "breadcrumb")}
                className={`truncate hover:underline ${i === trail.length - 1 ? "text-ink" : "text-muted"}`}
              >
                {selectionLabel(step)}
              </button>
            </Fragment>
          ))}
        </>
      ) : null}
    </div>
  );
}
