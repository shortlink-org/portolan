// Everywhere the chart draws an arrow into open water.
//
// There is no score. An edge either lands somewhere the catalog knows about
// or it does not, and the page is ordered the way a reader can act on it:
// errors before warnings, and under each rule its rows, so the words for
// what is wrong and what to do are said once and the rows are the edges.
// Every filter is in the URL, so a page a reader has narrowed is a link.

import { useDocumentTitle } from "../app/title";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ChevronDown, Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { catalog, index } from "../data";
import { useToastStore } from "../app/toast";
import { edgeCount } from "../lib/derive";
import type { Problem } from "../lib/derive";
import { contextVar, ctxStyle } from "../lib/context-color";
import { absoluteTime, plural, relativeTime } from "../lib/format";
import { problemRules as readProblemRules, saveProblemRules } from "../lib/local-api";
import { SUBJECTS, useProblemRules, useRuleEntries } from "../lib/problem-rules";
import type { ProblemRule, RuleSeverity, RuleSubject } from "../lib/problem-rules";
import { localStatusQuery } from "../lib/queries";
import { switched } from "../lib/rule-entries";
import { useProblemEvaluation } from "../lib/use-problems";
import { paths, servicePath } from "../routes";
import { CatEmptyState } from "../components/CatIllustration";
import { KindIcon } from "../components/kind";
import { ICON_OF, ProblemRow } from "../components/ProblemRow";

const CONTROL = "mono rounded-control border border-line bg-canvas px-2.5 py-1 text-ink outline-none focus:border-accent";
const FIELD = "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
const SUBJECT_NAMES = Object.keys(SUBJECTS) as RuleSubject[];
const SEVERITY_CHIP: Record<RuleSeverity, string> = {
  error: "chip status-unresolved",
  warning: "chip status-declared",
};

type By = "rule" | "service";

export function Problems() {
  useDocumentTitle("Problems");
  // Every filter lives in the URL: the sidebar arrives with `?context=`, the
  // Rules page with `?rule=`, and a reader who has narrowed the page hands
  // the address to a colleague and they see the same rows.
  const [params, setParams] = useSearchParams();
  const rules = useProblemRules();
  const { problems: all, failures } = useProblemEvaluation();
  const query = params.get("q") ?? "";
  const rule = params.get("rule") ?? "all";
  const over = (params.get("subject") ?? "all") as RuleSubject | "all";
  const severity = (params.get("severity") ?? "all") as RuleSeverity | "all";
  const by = (params.get("by") === "service" ? "service" : "rule") as By;
  const contexts = useMemo(() => new Set(params.getAll("context").filter((id) => catalog.contexts.some((c) => c.id === id))), [params]);

  const set = (key: string, value: string | string[]) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) if (item && item !== "all") next.append(key, item);
    setParams(next, { replace: true });
  };
  const toggleContext = (id: string) => {
    const next = new Set(contexts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set("context", [...next]);
  };
  const filtered = Boolean(query || rule !== "all" || over !== "all" || severity !== "all" || contexts.size > 0);
  const clear = () => setParams(new URLSearchParams(params.has("catalog") ? { catalog: params.get("catalog")! } : {}), { replace: true });

  // How many edges there were to resolve at all. Zero problems out of zero
  // edges is not a clean bill of health - nothing crossed a boundary, so
  // nothing was checked, and saying "every edge resolved" there is a green
  // tick the catalog has not earned.
  const edges = useMemo(() => edgeCount(catalog), []);
  const ruleOf = useMemo(() => new Map(rules.map((candidate) => [candidate.id, candidate])), [rules]);
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter((p) => {
        const made = ruleOf.get(p.rule);
        return (
          (contexts.size === 0 || contexts.has(p.context)) &&
          (rule === "all" || p.rule === rule) &&
          (over === "all" || made?.over === over) &&
          (severity === "all" || p.severity === severity) &&
          (!needle || `${p.id} ${p.peer} ${p.note ?? ""} ${p.service} ${p.rule}`.toLowerCase().includes(needle))
        );
      }),
    [all, contexts, rule, over, severity, needle, ruleOf],
  );
  const errors = all.filter((p) => p.severity === "error").length;
  const warnings = all.length - errors;
  const firing = new Set(all.map((p) => p.rule)).size;
  const off = rules.filter((candidate) => !candidate.enabled).length;
  const rulesShown = rules.filter((candidate) => all.some((p) => p.rule === candidate.id));
  const countIn = (contextId: string) => all.filter((p) => p.context === contextId).length;

  return (
    <div className="h-full overflow-y-auto p-gutter">
      {/* One line: the name, the two counts as the filters they are, and
          how much of this is the rules' doing. Two counts, not a score. */}
      <div className="flex max-w-table flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold">Problems</h1>
        {all.length > 0 ? (
          <div className="seg inline-flex" role="group" aria-label="Filter by severity">
            <SeverityPill count={errors} label="error" on={severity === "error"} onClick={() => set("severity", severity === "error" ? "all" : "error")} />
            <SeverityPill count={warnings} label="warning" on={severity === "warning"} onClick={() => set("severity", severity === "warning" ? "all" : "warning")} />
          </div>
        ) : null}
        <Link to={paths.settingsRules()} className="mono rounded-control text-muted hover:text-ink hover:underline" title="The rules on the Settings page">
          {firing} of {rules.length} {plural(rules.length, "rule")} firing{off > 0 ? ` · ${off} off` : ""}
        </Link>
        <span className="mono ml-auto text-faint" title={absoluteTime(catalog.generatedAt)}>
          checked {relativeTime(catalog.generatedAt)}
        </span>
      </div>

      {failures.length > 0 ? (
        <div className="mt-4 max-w-table rounded-control border border-unresolved px-3 py-2">
          <div className="text-ink">
            {failures.length} {plural(failures.length, "rule")} could not run, so the rows {failures.length === 1 ? "it" : "they"} would produce are missing
          </div>
          <ul className="mono mt-1 space-y-0.5 text-muted">
            {failures.map((failure) => (
              <li key={failure.rule}>
                <Link to={`${paths.settingsRules()}#rule-${failure.rule}`} className="text-accent hover:underline">
                  {failure.rule}
                </Link>{" "}
                — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {all.length === 0 ? (
        <ClearSkies checked={edges} off={off} />
      ) : (
        <>
          <div className="mt-section flex max-w-table flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
              <input
                type="search"
                aria-label="Find a problem"
                className={`${CONTROL} min-w-52 pl-7`}
                value={query}
                onChange={(event) => set("q", event.target.value)}
                placeholder="find by id, peer or note"
                spellCheck={false}
              />
            </label>
            {filtered ? (
              <span className="mono flex items-center gap-1.5 text-muted">
                <span>
                  <span className="tnum text-ink">{rows.length}</span> of {all.length}
                </span>
                <button type="button" className="tbtn py-0.5" onClick={clear} title="Clear every filter">
                  <X size={12} aria-hidden /> clear
                </button>
              </span>
            ) : null}
            {rulesShown.length > 1 ? (
              <select aria-label="Filter by rule" className={CONTROL} value={rulesShown.some((candidate) => candidate.id === rule) ? rule : "all"} onChange={(event) => set("rule", event.target.value)}>
                <option value="all">all rules</option>
                {rulesShown.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                  </option>
                ))}
              </select>
            ) : null}
            <select aria-label="Filter by subject" className={CONTROL} value={over} onChange={(event) => set("subject", event.target.value)}>
              <option value="all">all subjects</option>
              {SUBJECT_NAMES.filter((name) => rulesShown.some((candidate) => candidate.over === name)).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="seg inline-flex" role="group" aria-label="Group by">
              <button type="button" aria-pressed={by === "rule"} className={by === "rule" ? "is-on" : ""} onClick={() => set("by", "rule")}>
                by rule
              </button>
              <button type="button" aria-pressed={by === "service"} className={by === "service" ? "is-on" : ""} onClick={() => set("by", "service")}>
                by service
              </button>
            </div>
            <div className="seg ml-auto" role="group" aria-label="Filter by context">
              {catalog.contexts
                .filter((c) => countIn(c.id) > 0)
                .map((c) => {
                  const on = contexts.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleContext(c.id)}
                      aria-pressed={on}
                      className="flex items-center gap-1.5"
                      style={{
                        color: on ? contextVar(c.id) : "var(--fg-muted)",
                        background: on ? `color-mix(in srgb, ${contextVar(c.id)} 12%, transparent)` : undefined,
                      }}
                    >
                      <span aria-hidden className="size-1.5 rounded-[1px]" style={{ background: contextVar(c.id) }} />
                      {c.id}
                      <span className="tnum">{countIn(c.id)}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="mt-section max-w-table rounded-card border border-line px-4 py-6 text-center text-muted">
              Nothing matches. <button type="button" className="text-accent hover:underline" onClick={clear}>Clear the filters</button> to see all {all.length}.
            </div>
          ) : by === "rule" ? (
            <RuleGroups rows={rows} ruleOf={ruleOf} />
          ) : (
            <ServiceGroups rows={rows} />
          )}
        </>
      )}
    </div>
  );
}

/** A count that is also the filter for what it counts: a member of the severity segment. */
function SeverityPill({ count, label, on, onClick }: { count: number; label: "error" | "warning"; on: boolean; onClick: () => void }) {
  const colour = label === "error" ? "var(--status-unresolved)" : "var(--status-declared)";
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`flex items-center gap-1.5 ${on ? "is-on" : ""}`}
      onClick={onClick}
      disabled={count === 0 && !on}
      title={count === 0 ? `no ${plural(count, label)}` : on ? "Show all" : `Show only ${plural(count, label)}`}
    >
      <span aria-hidden className="size-1.5 rounded-[1px]" style={{ background: count > 0 ? colour : "var(--fg-faint)" }} />
      <span className="tnum">{count}</span> {plural(count, label)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The rows, under the rule that made them.

function RuleGroups({ rows, ruleOf }: { rows: Problem[]; ruleOf: Map<string, ProblemRule> }) {
  // Rule order is the rules' own, errors first: a group of errors is not the
  // same news as a group of warnings, and mixing them buries the first.
  const groups = useMemo(() => {
    const byRule = new Map<string, Problem[]>();
    for (const row of rows) byRule.set(row.rule, [...(byRule.get(row.rule) ?? []), row]);
    const list = [...byRule.entries()].map(([id, members]) => ({ rule: ruleOf.get(id), id, members }));
    return [...list.filter((group) => group.members[0]?.severity === "error"), ...list.filter((group) => group.members[0]?.severity !== "error")];
  }, [rows, ruleOf]);

  return (
    <div className="mt-section max-w-table space-y-grid" data-nav-list>
      {groups.map((group) => (
        <RuleGroup key={group.id} id={group.id} rule={group.rule} rows={group.members} />
      ))}
    </div>
  );
}

function RuleGroup({ id, rule, rows }: { id: string; rule: ProblemRule | undefined; rows: Problem[] }) {
  const severity = rows[0]?.severity ?? rule?.severity ?? "warning";
  const [asking, setAsking] = useState(false);
  return (
    <section className="overflow-hidden rounded-card border border-line shadow-xs" id={`rule-${id}`}>
      <header className="bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <KindIcon kind={ICON_OF[rule?.over ?? "service"]} />
          <span className="font-medium text-ink">{rule?.title ?? id}</span>
          <span className={SEVERITY_CHIP[severity]}>{severity}</span>
          <span className="mono text-muted">
            <span className="tnum">{rows.length}</span> {plural(rows.length, "row")}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <SwitchOff rule={rule} asking={asking} onAsk={setAsking} />
            <Link to={`${paths.settingsRules()}#rule-${id}`} className="mono rounded-control text-muted hover:text-ink hover:underline" title="The rule on the Settings page">
              {id} →
            </Link>
          </span>
        </div>
        {/* One line each, the whole text on hover: the header says what the
            rule is and what to do, and the rows below are what it found. */}
        {rule?.description ? (
          <p className="mt-1 truncate text-muted" title={rule.description}>
            {rule.description}
          </p>
        ) : null}
        {rule?.action ? (
          <p className="truncate text-muted" title={rule.action}>
            <span className="text-ink">What to do:</span> {rule.action}
          </p>
        ) : null}
        {asking && rule ? <SwitchOffForm rule={rule} onDone={() => setAsking(false)} /> : null}
      </header>
      <div className="divide-y divide-line">
        {rows.map((problem, i) => (
          <ProblemRow key={`${problem.rule}:${problem.id}:${problem.peer}`} problem={problem} index={i} showRule={false} />
        ))}
      </div>
    </section>
  );
}

/** The switch-off action, shown only where the page can write. */
function SwitchOff({ rule, asking, onAsk }: { rule: ProblemRule | undefined; asking: boolean; onAsk: (asking: boolean) => void }) {
  const status = useQuery(localStatusQuery());
  if (!status.isSuccess || !rule || !rule.enabled) return null;
  return (
    <button type="button" className="tbtn py-0.5" aria-expanded={asking} onClick={() => onAsk(!asking)}>
      switch off <ChevronDown size={12} aria-hidden className={`transition-transform ${asking ? "rotate-180" : ""}`} />
    </button>
  );
}

/**
 * Off, with a reason, without leaving the page: the entry is the one the
 * Rules page would write, through the same revision-checked save.
 */
function SwitchOffForm({ rule, onDone }: { rule: ProblemRule; onDone: () => void }) {
  const say = useToastStore((s) => s.say);
  const entries = useRuleEntries((s) => s.entries);
  const setEntries = useRuleEntries((s) => s.setEntries);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const current = await readProblemRules();
      const saved = await saveProblemRules(current.revision, switched(current.rules.length ? current.rules : entries, rule, false, reason.trim()));
      setEntries(saved.rules);
      say(`${rule.id} is off`);
      onDone();
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 rounded-control border border-accent bg-canvas p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="block min-w-64 flex-1">
        <span className="label mb-1.5 block">why is {rule.id} off here</span>
        <input className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="the estate shares one database by design" autoFocus />
      </label>
      <button type="submit" className="product-primary" disabled={!reason.trim() || busy}>
        Switch off
      </button>
      <button type="button" className="tbtn py-1.5" onClick={onDone} disabled={busy}>
        Keep on
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The rows, under the service whose end they are.

function ServiceGroups({ rows }: { rows: Problem[] }) {
  const groups = useMemo(() => {
    const byService = new Map<string, Problem[]>();
    for (const row of rows) byService.set(row.service, [...(byService.get(row.service) ?? []), row]);
    return [...byService.entries()].map(([service, members]) => ({ service, members }));
  }, [rows]);

  return (
    <div className="mt-section max-w-table space-y-grid" data-nav-list>
      {groups.map(({ service, members }) => {
        const owner = service ? index.serviceById.get(service) : undefined;
        const context = members[0]?.context ?? "";
        const errors = members.filter((p) => p.severity === "error").length;
        return (
          <section key={service || "nobody"} className="overflow-hidden rounded-card border border-line shadow-xs">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3 py-2">
              <KindIcon kind="service" />
              {owner ? (
                <Link to={servicePath(service) ?? paths.problems()} className="font-medium text-ink hover:underline">
                  {owner.name}
                </Link>
              ) : (
                <span className="font-medium text-ink">nobody in the catalog</span>
              )}
              {context ? (
                <span className="chip ctx" style={ctxStyle(context)}>
                  <span aria-hidden className="dot" />
                  {context}
                </span>
              ) : null}
              <span className="mono ml-auto text-muted">
                {errors > 0 ? <span className="text-unresolved">{errors} {plural(errors, "error")} · </span> : null}
                <span className="tnum">{members.length}</span> {plural(members.length, "row")}
              </span>
            </header>
            <div className="divide-y divide-line">
              {members.map((problem, i) => (
                <ProblemRow key={`${problem.rule}:${problem.id}:${problem.peer}`} problem={problem} index={i} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The one line the reader wants to see. Nothing else earns the space. */
function ClearSkies({ checked, off }: { checked: number; off: number }) {
  return (
    <CatEmptyState
      scene="clear"
      title={checked === 0 ? "Nothing to resolve yet" : "Clear skies"}
      className="mt-section max-w-prose"
      meta={
        off > 0 ? (
          <Link to={paths.settingsRules()} className="hover:underline">
            {off} {plural(off, "rule")} switched off
          </Link>
        ) : undefined
      }
    >
      {checked === 0 ? "No service calls another, and no event has a consumer." : `All ${checked} ${plural(checked, "edge")} resolved.`}
    </CatEmptyState>
  );
}
