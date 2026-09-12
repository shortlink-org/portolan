// One problem, as a row: the edge, the words for what is wrong with it,
// where it is met in the flows, and where the code is.
//
// The row is light on purpose: under a rule's heading on the Problems page
// the rule's words are said once, above, and the row is the edge and its
// note. On its own - the overview shows the first few - it wears the rule's
// words too, as a link to the rule. The rule's subject says where the near
// end leads: an event has a page, a table has a canvas, a channel, a call
// and a deployment are shown on their service's page.

import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { catalog, index } from "../data";
import type { Problem } from "../lib/derive";
import { ctxStyle } from "../lib/context-color";
import type { Kind } from "../lib/kinds";
import { staggerStyle } from "../lib/motion";
import { flowsOfProblem } from "../lib/problem-flows";
import { useProblemRules } from "../lib/problem-rules";
import type { RuleSubject } from "../lib/problem-rules";
import { sourceHref } from "../lib/source-link";
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
export function nearPath(over: RuleSubject, problem: Problem): string | null {
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

/** An http(s) URL the note ends with, for a row whose far end is a page elsewhere - the deployer's. */
function urlIn(note: string | undefined): string | null {
  const match = note?.match(/https?:\/\/\S+$/);
  return match ? match[0] : null;
}

const MAX_FLOWS = 4;

export function ProblemRow({
  problem,
  index: at,
  showRule = true,
}: {
  problem: Problem;
  index: number;
  /** Say which rule made the row. Off under a heading that already says so. */
  showRule?: boolean;
}) {
  const rules = useProblemRules();
  const rule = rules.find((candidate) => candidate.id === problem.rule);
  const over = rule?.over ?? "service";
  const near = nearPath(over, problem);
  const peerTo = peerPath(problem.peer);
  const note = rule?.note ?? problem.rule;
  const service = problem.service ? index.serviceById.get(problem.service) : undefined;
  const source = problem.source ? sourceHref(problem.source, service) : null;
  const url = over === "deployment" ? urlIn(problem.note) : null;
  const text = url && problem.note ? problem.note.slice(0, problem.note.length - url.length).trim() : problem.note;
  const flows = flowsOfProblem(catalog, index, over, problem);
  const tone = problem.severity === "error" ? "text-unresolved" : "text-declared";

  return (
    <div className="stagger-in px-3 py-2.5" style={staggerStyle(at)} data-rule={problem.rule}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <KindIcon kind={ICON_OF[over]} className="self-center" />
        {near ? (
          <Link to={near} data-nav-item className="mono rounded-control text-accent hover:underline" title={problem.id}>
            {problem.id}
          </Link>
        ) : (
          <Ident value={problem.id} />
        )}
        {/* A rule may name no far end; then there is no arrow to draw. */}
        {problem.peer ? (
          <>
            <span aria-hidden className="text-faint">
              →
            </span>
            {peerTo ? (
              <Link to={peerTo} className={`mono rounded-control hover:underline ${tone}`} title={problem.peer}>
                {problem.peer}
              </Link>
            ) : (
              <Ident value={problem.peer} className={tone} title={`${problem.peer} — ${note}. Click to copy.`} />
            )}
          </>
        ) : null}
        {problem.context ? (
          <span className="chip ctx" style={ctxStyle(problem.context)}>
            <span aria-hidden className="dot" />
            {problem.context}
          </span>
        ) : null}
        {showRule ? (
          <Link
            to={`${paths.settingsRules()}#rule-${problem.rule}`}
            className="mono ml-auto max-w-[45%] truncate rounded-control text-muted hover:text-ink hover:underline"
            title={`rule ${problem.rule}${rule?.action ? ` — ${rule.action}` : ""}`}
          >
            {note}
          </Link>
        ) : null}
      </div>
      {text ? <p className="mt-1 max-w-prose text-muted">{text}</p> : null}
      {flows.length > 0 || source || url ? (
        <div className="mono mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          {flows.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-faint">in</span>
              {flows.slice(0, MAX_FLOWS).map((hit) => (
                <Link
                  key={hit.flow.id}
                  to={hit.stepId ? paths.flowStep(hit.flow.slug, hit.stepId) : paths.flow(hit.flow.slug)}
                  className="chip border-line-strong hover:border-accent hover:text-accent"
                  title={hit.stepId ? `${hit.flow.name}, step ${hit.number}` : hit.flow.name}
                >
                  {hit.flow.name}
                  {hit.number ? <span className="text-faint">·{hit.number}</span> : null}
                </Link>
              ))}
              {flows.length > MAX_FLOWS ? (
                <span className="text-faint" title={flows.slice(MAX_FLOWS).map((hit) => hit.flow.name).join(", ")}>
                  +{flows.length - MAX_FLOWS}
                </span>
              ) : null}
            </span>
          ) : null}
          {problem.source ? (
            source ? (
              <a href={source} target="_blank" rel="noreferrer" className="truncate rounded-control text-accent hover:underline" title={problem.source}>
                {problem.source} ↗
              </a>
            ) : (
              <Ident value={problem.source} className="truncate" />
            )
          ) : null}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-control text-accent hover:underline">
              <ExternalLink size={12} aria-hidden /> open in the deployer
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
