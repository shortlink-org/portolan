// One problem, as a row: what the near end is, where both ends live, and
// the words for what is wrong with the edge between them. The problems page
// lists every one of these; the overview shows the first few.
//
// The words and the icon come from the rule that made the row - its passport
// in rules/builtin.json, or the manifest's entry for a CEL rule - so a rule
// added to the manifest gets a row that reads like the built-in ones, and
// the built-in ones can be read about on the Settings page the note links to.

import { Link } from "react-router";
import type { Problem } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import type { Kind } from "../lib/kinds";
import { staggerStyle } from "../lib/motion";
import { useProblemRules } from "../lib/problem-rules";
import type { ProblemRule, RuleSubject } from "../lib/problem-rules";
import {
  eventPath,
  paths,
  servicePath,
  storePath,
  tablePath,
  viewPath,
} from "../routes";
import { KindIcon } from "./kind";
import { Ident } from "./Ident";

/** The icon a problem row carries: what the near end of the edge IS. */
const ICON_OF: Record<RuleSubject, Kind> = {
  service: "service",
  call: "service",
  event: "event",
  channel: "event",
  table: "table",
  deployment: "service",
};

/** Where the near end of a problem lives, by what kind of edge it is. */
function nearPath(problem: Problem, rule: ProblemRule | undefined): string | null {
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
    // A CEL rule's row is about one subject, and the subject says where it
    // lives: an event has a page, a table has a canvas, a channel, a call and
    // a deployment are shown on their service's page.
    case "rule":
      return subjectPath(rule?.over ?? "service", problem);
  }
}

function subjectPath(over: RuleSubject, problem: Problem): string | null {
  switch (over) {
    case "event":
      return eventPath(problem.id);
    case "table":
      return relationPath(problem.id);
    case "service":
    case "call":
    case "channel":
    case "deployment":
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
    // A CEL rule's peer is whatever its expression said; when that is the id
    // of something the catalog has, the row leads there.
    case "rule":
      return problem.peer
        ? servicePath(problem.peer) ?? eventPath(problem.peer) ?? relationPath(problem.peer)
        : null;
    default:
      return null;
  }
}

export function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
  const rules = useProblemRules();
  const rule = rules.find((candidate) => candidate.id === problem.rule);
  const near = nearPath(problem, rule);
  const peerTo = peerPath(problem);
  const note = rule?.note ?? problem.rule;
  const tone =
    problem.severity === "error"
      ? "var(--status-unresolved)"
      : "var(--status-declared)";

  return (
    <div
      className="stagger-in flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border px-3 py-2"
      style={{ ...staggerStyle(index), borderColor: tone }}
      data-rule={problem.rule}
    >
      <KindIcon kind={ICON_OF[rule?.over ?? "service"]} />
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
      {/* A CEL rule may name no far end; then there is no arrow to draw. */}
      {problem.peer ? (
        <>
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
              title={`${problem.peer} — ${note}. Click to copy.`}
            />
          )}
        </>
      ) : null}
      {/* A problem with no near end in the estate has no context to wear:
          a chip with nothing in it would be a claim about a context named "". */}
      {problem.context ? (
        <span className="chip ctx" style={ctxStyle(problem.context)}>
          <span aria-hidden className="dot" />
          {problem.context}
        </span>
      ) : null}
      {/* The rule's words, leading to the rule: what it checks, what to do,
          and the switch that turns it off. */}
      <Link
        to={`${paths.settingsRules()}#rule-${problem.rule}`}
        className="mono ml-auto rounded-control text-muted hover:text-ink hover:underline"
        title={`rule ${problem.rule}${rule?.action ? ` — ${rule.action}` : ""}`}
      >
        {note}
      </Link>
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
