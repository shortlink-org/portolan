// One problem, as a row: what the near end is, where both ends live, and
// the words for what is wrong with the edge between them. The problems page
// lists every one of these; the overview shows the first few.

import { Link } from "react-router";
import type { Problem } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import { staggerStyle } from "../lib/motion";
import {
  eventPath,
  servicePath,
  storePath,
  tablePath,
  viewPath,
} from "../routes";
import { KindIcon } from "./kind";
import { Ident } from "./Ident";

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
  "proto-drift": "service",
  "shared-channel": "event",
  "channel-undeclared": "event",
  "channel-unpublished": "service",
  "message-encoding": "service",
  "subscription-unresolved": "service",
  "deployment-unclaimed": "service",
  "deployment-drift": "service",
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
  "proto-drift": "the vendored proto and provider schema disagree",
  "shared-channel": "a second service publishes on this channel",
  "channel-undeclared":
    "this event goes out on a channel the service does not declare",
  "channel-unpublished": "a declared channel no event of this service names",
  "message-encoding": "publisher and subscriber use different payload encodings",
  "subscription-unresolved":
    "nothing in the catalog publishes what this service listens for",
  "deployment-unclaimed":
    "the deployer runs this from a repository and directory no service in the catalog lives at",
  "deployment-drift":
    "the GitOps tree and the deployer disagree about this Application",
};

/** Where the near end of a problem lives, by what kind of edge it is. */
function nearPath(problem: Problem): string | null {
  switch (problem.kind) {
    case "rpc":
    // The near end is the CALLING service either way. `rpc` is a call whose
    // peer is nobody; this is a call whose peer is known and whose method is
    // not - and in both the thing to go and look at is the caller.
    case "proto-missing":
    case "proto-drift":
      return servicePath(problem.service);
    case "consumer":
    case "channel-undeclared":
      return eventPath(problem.id);
    // The near end is an event when the service has one on the channel, and
    // the service itself when the claim comes from its document alone.
    case "shared-channel":
      return eventPath(problem.id) ?? servicePath(problem.service);
    case "channel-unpublished":
    case "message-encoding":
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
    // The near end is an Application nobody in the catalog is: there is no
    // page for it here, and the deployer's own page is in the note.
    case "deployment-unclaimed":
      return null;
    // The near end is the service the Application deploys, when the
    // catalog has one; its page is where the row with the drift chip is.
    case "deployment-drift":
      return problem.service ? servicePath(problem.service) : null;
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
    case "message-encoding":
      return servicePath(problem.peer);
    case "outbox-payload":
      return storePath(problem.peer);
    default:
      return null;
  }
}

export function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
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
      {/* A problem with no near end in the estate has no context to wear:
          a chip with nothing in it would be a claim about a context named "". */}
      {problem.context ? (
        <span className="chip ctx" style={ctxStyle(problem.context)}>
          <span aria-hidden className="dot" />
          {problem.context}
        </span>
      ) : null}
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
