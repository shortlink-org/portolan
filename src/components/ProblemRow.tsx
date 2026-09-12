// One problem, as a row: what the near end is, where both ends live, and
// the words for what is wrong with the edge between them. The problems page
// lists every one of these; the overview shows the first few.
//
// The words and the icon come from the rule that made the row - its passport
// in rules/builtin.json, or the manifest's entry - and the rule's subject
// says where the near end leads: an event has a page, a table has a canvas,
// a channel, a call and a deployment are shown on their service's page.

import { Link } from "react-router";
import type { Problem } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import type { Kind } from "../lib/kinds";
import { staggerStyle } from "../lib/motion";
import { useProblemRules } from "../lib/problem-rules";
import type { RuleSubject } from "../lib/problem-rules";
import {
  aggregatePath,
  eventPath,
  flowPath,
  paths,
  servicePath,
  storePath,
  tablePath,
  viewPath,
} from "../routes";
import { KindIcon } from "./kind";
import { Ident } from "./Ident";

/** The icon a problem row carries: what the near end of the edge IS. */
export const ICON_OF: Record<RuleSubject, Kind> = {
  service: "service",
  call: "service",
  copy: "service",
  event: "event",
  consumer: "event",
  channel: "event",
  subscription: "service",
  table: "table",
  column: "table",
  deployment: "service",
  flow: "flow",
  aggregate: "aggregate",
};

/** A table or a view, whichever the id turns out to name. */
function relationPath(id: string): string | null {
  return tablePath(id) ?? viewPath(id);
}

/** A column's relation: its id minus the column, which is what the canvas can show. */
function columnPath(id: string): string | null {
  return relationPath(id.split(".").slice(0, -1).join("."));
}

/** Where the near end of a problem lives, by what the rule is about. */
function nearPath(over: RuleSubject, problem: Problem): string | null {
  switch (over) {
    case "event":
    case "consumer":
      return eventPath(problem.id);
    // A channel row is an event of the service when it has one on the
    // address, and the service itself when the claim comes from its document.
    case "channel":
      return eventPath(problem.id) ?? (problem.service ? servicePath(problem.service) : null);
    case "table":
      return relationPath(problem.id);
    case "column":
      return columnPath(problem.id);
    case "flow":
      return flowPath(problem.id);
    case "aggregate":
      return aggregatePath(problem.id);
    case "service":
    case "call":
    case "copy":
    case "subscription":
    case "deployment":
      return problem.service ? servicePath(problem.service) : null;
  }
}

/** Where the far end lives, when it is the id of something the catalog has. */
function peerPath(peer: string): string | null {
  if (!peer) return null;
  return servicePath(peer) ?? eventPath(peer) ?? relationPath(peer) ?? columnPath(peer) ?? storePath(peer);
}

export function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
  const rules = useProblemRules();
  const rule = rules.find((candidate) => candidate.id === problem.rule);
  const over = rule?.over ?? "service";
  const near = nearPath(over, problem);
  const peerTo = peerPath(problem.peer);
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
      <KindIcon kind={ICON_OF[over]} />
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
      {/* A rule may name no far end; then there is no arrow to draw. */}
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
