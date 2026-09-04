// Everywhere the chart draws an arrow into open water.
//
// There is no score and no severity column. An edge either lands somewhere the
// catalog knows about or it does not, and the only useful ordering is the one
// the reader can act on: by the service that owns the near end.

import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { catalog, index } from "../data";
import { edgeCount, problems } from "../lib/derive";
import type { Problem } from "../lib/derive";
import { dataProblems } from "../lib/data-problems";
import { protoProblems } from "../lib/proto-problems";
import { wireProblems } from "../lib/wire-problems";
import { contextVar, ctxStyle } from "../lib/context-color";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { staggerStyle } from "../lib/motion";
import { KindIcon } from "../components/kind";
import { Ident } from "../components/Ident";
import { SectionTitle } from "../components/PageHeader";
import {
  eventPath,
  servicePath,
  storePath,
  tablePath,
  viewPath,
} from "../routes";

/** The icon a problem row carries: what the near end of the edge IS. */
const KIND_OF: Record<Problem["kind"], "service" | "event" | "table"> = {
  rpc: "service",
  consumer: "event",
  "cross-service-fk": "table",
  "cross-service-lineage": "table",
  "shared-store": "table",
  "persistence-drift": "table",
  "column-type": "table",
  "outbox-payload": "table",
  "proto-missing": "service",
  "shared-channel": "event",
  "channel-undeclared": "event",
  "channel-unpublished": "service",
  "subscription-unresolved": "service",
};

const KIND_NOTE: Record<Problem["kind"], string> = {
  rpc: "the provider of this call is not in the catalog",
  consumer: "this consumer of the event is not in the catalog",
  "cross-service-fk": "foreign key across a service boundary",
  "cross-service-lineage": "a value copied from another service's schema",
  "shared-store": "a second service writes this database",
  "persistence-drift": "this table no longer carries the aggregate it claims",
  "column-type": "column type and domain type disagree",
  "outbox-payload": "an outbox with no payload column",
  "proto-missing":
    "the provider is in the catalog but answers on no such method",
  "shared-channel": "a second service publishes on this channel",
  "channel-undeclared":
    "this event goes out on a channel the service does not declare",
  "channel-unpublished": "a declared channel no event of this service names",
  "subscription-unresolved":
    "nothing in the catalog publishes what this service listens for",
};

export function Problems() {
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
  const all = useMemo(() => {
    const found = [
      ...problems(catalog),
      ...protoProblems(catalog, index),
      ...dataProblems(catalog, index),
      ...wireProblems(catalog, index),
    ];
    return [
      ...found.filter((p) => p.severity === "error"),
      ...found.filter((p) => p.severity === "warning"),
    ];
  }, []);
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
    <div className="empty mt-section max-w-table">
      {checked === 0
        ? "Nothing to resolve yet — no service calls another, and no event has a consumer."
        : `Clear skies — all ${checked} ${plural(checked, "edge")} resolved.`}
      <span className="ml-2" title={absoluteTime(catalog.generatedAt)}>
        last checked {relativeTime(catalog.generatedAt)}
      </span>
    </div>
  );
}

/** Where the near end of a problem lives, by what kind of edge it is. */
function nearPath(problem: Problem): string | null {
  switch (problem.kind) {
    case "rpc":
    // The near end is the CALLING service either way. `rpc` is a call whose
    // peer is nobody; this is a call whose peer is known and whose method is
    // not - and in both the thing to go and look at is the caller.
    case "proto-missing":
      return servicePath(problem.service);
    case "consumer":
    case "channel-undeclared":
      return eventPath(problem.id);
    // The near end is an event when the service has one on the channel, and
    // the service itself when the claim comes from its document alone.
    case "shared-channel":
      return eventPath(problem.id) ?? servicePath(problem.service);
    case "channel-unpublished":
    case "subscription-unresolved":
      return servicePath(problem.service);
    case "shared-store":
    case "persistence-drift":
    case "outbox-payload":
      return tablePath(problem.id);
    // The id is "<relation>.<column>", so the relation is its own id minus the
    // last segment — and the relation is what the canvas can actually show.
    case "cross-service-fk":
    case "column-type":
      return relationPath(problem.id.split(".").slice(0, -1).join("."));
    // Lineage is stated on a column, except when a view states it whole, so
    // the id is one or the other and both are looked up the same way.
    case "cross-service-lineage":
      return (
        relationPath(problem.id) ??
        relationPath(problem.id.split(".").slice(0, -1).join("."))
      );
  }
}

/** A table or a view, whichever the id turns out to name. */
function relationPath(id: string): string | null {
  return tablePath(id) ?? viewPath(id);
}

/** Where the far end lives, when the catalog knows it. */
function peerPath(problem: Problem): string | null {
  switch (problem.kind) {
    case "cross-service-fk":
      return tablePath(problem.peer);
    case "cross-service-lineage":
      return (
        relationPath(problem.peer) ??
        relationPath(problem.peer.split(".").slice(0, -1).join("."))
      );
    case "shared-store":
    case "shared-channel":
      return servicePath(problem.peer);
    case "outbox-payload":
      return storePath(problem.peer);
    default:
      return null;
  }
}

function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
  const near = nearPath(problem);
  const peerTo = peerPath(problem);
  const tone =
    problem.severity === "error"
      ? "var(--status-unresolved)"
      : "var(--status-declared)";

  return (
    <div
      className="stagger-in flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border px-3 py-2"
      style={{ ...staggerStyle(index), borderColor: tone }}
    >
      <KindIcon kind={KIND_OF[problem.kind]} />
      {near ? (
        <Link
          to={near}
          data-nav-item
          className="mono rounded-control text-accent hover:underline"
          title={problem.id}
        >
          {problem.id}
        </Link>
      ) : (
        <Ident value={problem.id} />
      )}
      <span aria-hidden className="text-muted">
        →
      </span>
      {peerTo ? (
        <Link
          to={peerTo}
          className="mono rounded-control hover:underline"
          style={{ color: tone }}
          title={problem.peer}
        >
          {problem.peer}
        </Link>
      ) : (
        <Ident
          value={problem.peer}
          className={
            problem.severity === "error" ? "text-unresolved" : "text-declared"
          }
          title={`${problem.peer} — ${KIND_NOTE[problem.kind]}. Click to copy.`}
        />
      )}
      <span className="chip ctx" style={ctxStyle(problem.context)}>
        <span aria-hidden className="dot" />
        {problem.context}
      </span>
      <span className="mono ml-auto text-muted">{KIND_NOTE[problem.kind]}</span>
      {problem.note ? (
        <p className="w-full border-l-2 pl-2 border-line-strong text-muted">
          {problem.note}
        </p>
      ) : null}
      {problem.source ? (
        <div className="mono w-full text-muted">
          <Ident value={problem.source} />
        </div>
      ) : null}
    </div>
  );
}
