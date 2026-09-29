// The rules behind the Problems page, as a table with switches.
//
// Every row is one rule: the built-in readers with their passports from
// rules/builtin.json, then the estate's own, written in CEL in portolan.json.
// A reader sees what each checks, how many rows it produces right now, and
// what to do about one; in local mode they switch a rule off with a reason
// or re-grade it here. A rule is written on its own page (RuleWorkbench.tsx),
// where it runs over the catalog before it is saved. Nothing is written until
// the server has type-checked every expression against the same module the
// page checked it with.
//
// The page is laid out like the pipeline's plugin list - one bordered card,
// a muted group header, rows that open in place - so a reader who knows one
// settings tab knows this one. A row reads left to right the way a reader
// asks: is it on, what is it about, what is it called, how bad is a hit, how
// many hits are there now.

import { useState } from "react";
import { Switch } from "@headlessui/react";
import { Link } from "react-router";
import { ArrowRight, ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { KindIcon } from "../../components/kind";
import { ICON_OF } from "../../components/ProblemRow";
import { SectionTitle } from "../../components/PageHeader";
import { plural } from "../../lib/format";
import { SUBJECTS, useProblemRules } from "../../lib/problem-rules";
import type { ProblemRule, ProblemRuleEntry, RuleSeverity, RuleSubject } from "../../lib/problem-rules";
import { regraded, switched } from "../../lib/rule-entries";
import { useProblemEvaluation } from "../../lib/use-problems";
import { useRuleFile } from "../../lib/use-rule-file";
import { paths } from "../../routes";

const FIELD = "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
// A control that takes its own width: a filter beside other filters.
const CONTROL = "mono rounded-control border border-line bg-canvas px-2.5 py-1 text-ink outline-none focus:border-accent";
const SUBJECT_NAMES = Object.keys(SUBJECTS) as RuleSubject[];


const SEVERITY_CHIP: Record<RuleSeverity, string> = {
  error: "chip status-unresolved",
  warning: "chip status-declared",
};

export function RulesSettings({ local }: { local: boolean }) {
  const rules = useProblemRules();
  const { matches, failures } = useProblemEvaluation();
  const { entries, revision, busy, write: writeFile } = useRuleFile(local);
  const write = (next: ProblemRuleEntry[], done: string) => void writeFile(next, done);

  // The filters narrow what is listed, never what is in force: a rule hidden
  // here still runs. They are the page's own state and are not written
  // anywhere - a filter is how a reader looks, not a fact about the estate.
  const [query, setQuery] = useState("");
  const [over, setOver] = useState<RuleSubject | "all">("all");
  const [severity, setSeverity] = useState<RuleSeverity | "all">("all");
  const [state, setState] = useState<"all" | "on" | "off">("all");
  const [rows, setRows] = useState<"all" | "with" | "without">("all");
  const needle = query.trim().toLowerCase();
  const shown = rules.filter((rule) => {
    const count = matches.get(rule.id) ?? 0;
    return (
      (over === "all" || rule.over === over) &&
      (severity === "all" || rule.severity === severity) &&
      (state === "all" || (state === "on") === rule.enabled) &&
      (rows === "all" || (rows === "with") === count > 0) &&
      (!needle || rule.id.includes(needle) || rule.title.toLowerCase().includes(needle) || rule.note.toLowerCase().includes(needle))
    );
  });
  const filtered = shown.length !== rules.length;
  const clearFilters = () => {
    setQuery("");
    setOver("all");
    setSeverity("all");
    setState("all");
    setRows("all");
  };
  const builtin = shown.filter((rule) => rule.builtin);
  const custom = shown.filter((rule) => !rule.builtin);
  const customTotal = rules.filter((rule) => !rule.builtin).length;
  const off = rules.filter((rule) => !rule.enabled).length;
  const producing = rules.filter((rule) => rule.enabled && (matches.get(rule.id) ?? 0) > 0).length;
  const total = rules.filter((rule) => rule.enabled).reduce((sum, rule) => sum + (matches.get(rule.id) ?? 0), 0);
  const canWrite = local && revision !== null && !busy;

  const row = (rule: ProblemRule) => (
    <RuleRow
      key={rule.id}
      rule={rule}
      count={matches.get(rule.id) ?? 0}
      failure={failures.find((failure) => failure.rule === rule.id)?.message}
      canWrite={canWrite}
      onToggle={(enabled, reason) => write(switched(entries, rule, enabled, reason), enabled ? `${rule.id} is on` : `${rule.id} is off`)}
      onSeverity={(next) => write(regraded(entries, rule, next), `${rule.id} is now ${next}`)}
      {...(rule.builtin ? {} : { onRemove: () => write(entries.filter((entry) => entry.id !== rule.id), `${rule.id} is removed`) })}
    />
  );

  return (
    <section>
      <SectionTitle right={local ? "written to portolan.json after a type check" : "declared in portolan.json"}>Rules</SectionTitle>
      <p className="max-w-prose text-muted">
        What the Problems page looks for. Every rule is one condition in CEL over one subject - a table that knows who writes it, a channel that knows who
        else publishes there. The shipped ones can be switched off or re-graded here, with a reason; a rule of your own is written the same way and runs the
        moment it is saved.
      </p>

      {/* Four numbers a reader wants before the list: how many rules there
          are, how many are finding something, how many the estate switched
          off, and how many it wrote itself. */}
      <div className="mt-4 grid grid-cols-2 gap-grid sm:grid-cols-4">
        <Stat value={rules.length} label={plural(rules.length, "rule")} />
        <Stat value={producing} label={`producing ${total} ${plural(total, "row")}`} to={paths.problems()} />
        <Stat value={off} label="switched off" tone={off > 0 ? "muted" : undefined} />
        <Stat value={customTotal} label="of your own" />
      </div>

      {failures.length > 0 ? (
        <div className="mt-4 rounded-control border border-unresolved px-3 py-2">
          <div className="text-ink">
            {failures.length} {plural(failures.length, "rule")} could not run, so the rows {failures.length === 1 ? "it" : "they"} would produce are missing
          </div>
          <ul className="mono mt-1 space-y-0.5 text-muted">
            {failures.map((failure) => (
              <li key={failure.rule}>
                <a href={`#rule-${failure.rule}`} className="text-accent hover:underline">
                  {failure.rule}
                </a>{" "}
                — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-section flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            aria-label="Find a rule"
            className={`${CONTROL} min-w-52 pl-7`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="find by id or title"
            spellCheck={false}
          />
        </label>
        <select aria-label="Filter rules by subject" className={CONTROL} value={over} onChange={(event) => setOver(event.target.value as RuleSubject | "all")}>
          <option value="all">all subjects</option>
          {SUBJECT_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Filter rules by severity" className={CONTROL} value={severity} onChange={(event) => setSeverity(event.target.value as RuleSeverity | "all")}>
          <option value="all">all severities</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
        </select>
        <select aria-label="Filter rules by switch" className={CONTROL} value={state} onChange={(event) => setState(event.target.value as "all" | "on" | "off")}>
          <option value="all">on and off</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
        <select aria-label="Filter rules by rows" className={CONTROL} value={rows} onChange={(event) => setRows(event.target.value as "all" | "with" | "without")}>
          <option value="all">with and without rows</option>
          <option value="with">with rows</option>
          <option value="without">without rows</option>
        </select>
        {filtered ? (
          <span className="mono ml-auto flex items-center gap-2 text-muted">
            <span>
              <span className="tnum text-ink">{shown.length}</span> of {rules.length}
            </span>
            <button type="button" className="tbtn py-0.5" onClick={clearFilters}>
              <X size={12} aria-hidden /> clear
            </button>
          </span>
        ) : null}
      </div>

      <div className="mt-3 overflow-hidden rounded-card border border-line shadow-xs">
        <section>
          <h3 className="label flex items-center gap-2 bg-surface px-3 py-1.5">
            built in
            <span className="text-muted/70">{builtin.length}</span>
          </h3>
          {builtin.length === 0 ? <p className="mono border-t border-line px-3 py-3 text-muted">No built-in rule matches the filter.</p> : null}
          {builtin.map(row)}
        </section>
        <section className="border-t border-line">
          <h3 className="label flex items-center gap-2 bg-surface px-3 py-1.5">
            yours
            <span className="text-muted/70">{customTotal}</span>
            {local ? (
              <Link to={paths.settingsRuleNew()} className="tbtn ml-auto normal-case">
                <Plus size={13} aria-hidden /> Add rule
              </Link>
            ) : null}
          </h3>
          {custom.length === 0 ? (
            <p className="border-t border-line px-3 py-3 text-muted">
              {customTotal > 0
                ? "No rule of yours matches the filter."
                : local
                  ? "No rules of your own yet. A rule is one subject, a condition and a message; the built-in rows above show the shape."
                  : "portolan.json declares no rules of its own."}
            </p>
          ) : null}
          {custom.map(row)}
        </section>
      </div>

      <SubjectReference />
    </section>
  );
}

function Stat({ value, label, to, tone }: { value: number; label: string; to?: string; tone?: "muted" }) {
  const body = (
    <>
      <span className={`tnum text-lg leading-none ${tone === "muted" && value > 0 ? "text-declared" : "text-ink"}`}>{value}</span>
      <span className="mono mt-1 block text-muted">{label}</span>
    </>
  );
  const className = "block rounded-control border border-line px-3 py-2";
  return to ? (
    <Link to={to} className={`${className} hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ---------------------------------------------------------------------------
// One rule.

/**
 * The switch the delivery presets use: Headless UI's, styled the same way,
 * so a toggle is one thing across the settings tabs. Off on a shipped rule
 * in local mode asks for a reason first, which is why the change handler
 * is the row's and not a plain setter.
 */
function RuleSwitch({ on, id, disabled, onChange }: { on: boolean; id: string; disabled: boolean; onChange: () => void }) {
  return (
    <Switch
      checked={on}
      disabled={disabled}
      onChange={onChange}
      aria-label={`Switch ${on ? "off" : "on"} ${id}`}
      title={disabled ? "local mode required" : on ? "on · click to switch off" : "off · click to switch on"}
      className="group inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface transition-colors outline-none data-checked:border-accent data-checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className="size-3.5 translate-x-0.5 rounded-full bg-muted shadow-xs transition-transform group-data-checked:translate-x-[18px] group-data-checked:bg-canvas"
      />
    </Switch>
  );
}

function RuleRow({
  rule,
  count,
  failure,
  canWrite,
  onToggle,
  onSeverity,
  onRemove,
}: {
  rule: ProblemRule;
  count: number;
  failure: string | undefined;
  canWrite: boolean;
  onToggle: (enabled: boolean, reason: string) => void;
  onSeverity: (severity: RuleSeverity) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState("");
  const regradedFrom = rule.severity !== rule.defaultSeverity ? rule.defaultSeverity : null;

  function toggle() {
    if (!canWrite) return;
    if (rule.enabled && rule.builtin) {
      setAskingReason(true);
      setOpen(true);
      return;
    }
    onToggle(!rule.enabled, "");
  }

  return (
    <div id={`rule-${rule.id}`} className="scroll-mt-4 border-t border-line">
      <div className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto_5.5rem_auto] ${open ? "bg-surface/60" : "hover:bg-surface/60"}`}>
        <RuleSwitch on={rule.enabled} id={rule.id} disabled={!canWrite} onChange={toggle} />
        <KindIcon kind={ICON_OF[rule.over]} className={rule.enabled ? "" : "opacity-50"} />
        <button
          type="button"
          className="min-w-0 cursor-pointer text-left"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${rule.id}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block truncate ${rule.enabled ? "text-ink" : "text-muted"}`}>{rule.title}</span>
          {/* One line of what the rule checks. The id, the subject and the
              CEL are read in the panel; a closed row is for scanning. */}
          <span className="block truncate text-muted" title={rule.description}>
            {!rule.enabled ? <span className="text-faint">off{rule.reason ? ` — ${rule.reason}` : ""} · </span> : null}
            {rule.enabled && regradedFrom ? <span className="text-faint">was {regradedFrom} · </span> : null}
            {rule.description || rule.note}
          </span>
        </button>
        <span className={SEVERITY_CHIP[rule.severity]} title={regradedFrom ? `re-graded from ${regradedFrom}` : undefined}>
          {rule.severity}
        </span>
        <span className="mono hidden text-right text-muted sm:block">
          {failure ? (
            <span className="text-unresolved">failed</span>
          ) : count > 0 ? (
            <Link
              to={`${paths.problems()}?rule=${encodeURIComponent(rule.id)}`}
              className={`hover:underline ${rule.enabled ? "text-ink" : ""}`}
              title={rule.enabled ? "Rows on the Problems page" : "Rows this rule would produce if switched on"}
            >
              <span className="tnum">{count}</span> {plural(count, "row")}
            </Link>
          ) : (
            <span className="text-faint">no rows</span>
          )}
        </span>
        <button type="button" className="tbtn hidden border-transparent p-1 sm:flex" aria-hidden tabIndex={-1} onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={15} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open ? (
        <div className="border-t border-line bg-surface/50 px-4 py-4">
          {askingReason ? (
            <form
              className="mb-4 flex flex-wrap items-end gap-2 rounded-control border border-accent bg-canvas p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!reason.trim()) return;
                onToggle(false, reason.trim());
                setAskingReason(false);
                setReason("");
              }}
            >
              <label className="block min-w-64 flex-1">
                <span className="label mb-1.5 block">why is this rule off here</span>
                <input className={FIELD} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="the estate shares one database by design" autoFocus />
              </label>
              <button type="submit" className="product-primary" disabled={!reason.trim()}>
                Switch off
              </button>
              <button type="button" className="tbtn py-1.5" onClick={() => setAskingReason(false)}>
                Keep on
              </button>
            </form>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(14rem,1fr)]">
            <div className="space-y-4">
              {rule.description ? (
                <div>
                  <div className="label mb-1.5">what it checks</div>
                  <p className="max-w-prose text-ink">{rule.description}</p>
                </div>
              ) : null}
              {rule.action ? (
                <div>
                  <div className="label mb-1.5">what to do about a row</div>
                  <p className="max-w-prose text-muted">{rule.action}</p>
                </div>
              ) : null}
              {rule.when ? <Expression label="when" source={rule.when} /> : null}
              {rule.message ? <Expression label="message" source={rule.message} /> : null}
              {rule.peer ? <Expression label="peer" source={rule.peer} /> : null}
              {failure ? (
                <div>
                  <div className="label mb-1.5 text-unresolved">could not run</div>
                  <p className="mono text-unresolved">{failure}</p>
                </div>
              ) : null}
            </div>
            <dl className="mono grid h-fit grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-muted">
              <dt>id</dt>
              <dd className="text-ink">{rule.id}</dd>
              <dt>subject</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                <KindIcon kind={ICON_OF[rule.over]} size={12} /> {rule.over}
              </dd>
              <dt>severity</dt>
              <dd>
                {canWrite ? (
                  <select aria-label={`Severity of ${rule.id}`} className={CONTROL} value={rule.severity} onChange={(event) => onSeverity(event.target.value as RuleSeverity)}>
                    <option value="error">error</option>
                    <option value="warning">warning</option>
                  </select>
                ) : (
                  <span className={SEVERITY_CHIP[rule.severity]}>{rule.severity}</span>
                )}
                {regradedFrom ? <span className="ml-2 text-faint">was {regradedFrom}</span> : null}
              </dd>
              <dt>rows</dt>
              <dd className="text-ink">
                {count > 0 ? (
                  <Link to={`${paths.problems()}?rule=${encodeURIComponent(rule.id)}`} className="text-accent hover:underline">
                    {count} on the Problems page
                  </Link>
                ) : (
                  <span className="text-muted">none right now</span>
                )}
              </dd>
              <dt>state</dt>
              <dd className="text-ink">{rule.enabled ? "on" : "off"}</dd>
              {rule.reason ? (
                <>
                  <dt className="self-start">reason</dt>
                  <dd className="font-sans text-ink">{rule.reason}</dd>
                </>
              ) : null}
              <dt>written in</dt>
              <dd className="text-ink">{rule.builtin ? "rules/builtin.json, shipped with Portolan" : "portolan.json → problemRules"}</dd>
              <dt />
              <dd className="flex flex-wrap gap-2">
                {/* The rule's page lists its rows with why each matched; a rule of your own is edited there. */}
                <Link to={paths.settingsRule(rule.id)} className="tbtn">
                  {rule.builtin || !canWrite ? (
                    <>
                      Rows and why <ArrowRight size={13} aria-hidden />
                    </>
                  ) : (
                    <>
                      <Pencil size={13} aria-hidden /> Edit
                    </>
                  )}
                </Link>
                {onRemove ? (
                  <button type="button" className="tbtn text-unresolved" onClick={onRemove} disabled={!canWrite}>
                    <Trash2 size={13} aria-hidden /> Remove
                  </button>
                ) : null}
              </dd>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Expression({ label, source }: { label: string; source: string }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <pre className="mono overflow-x-auto rounded-control border border-line bg-canvas px-3 py-2 whitespace-pre-wrap text-ink">{source}</pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What an expression may read.

function SubjectReference() {
  return (
    <details className="group mt-section">
      <summary className="label flex cursor-pointer list-none items-center gap-1.5">
        <ChevronDown size={13} aria-hidden className="transition-transform group-open:rotate-180" /> what a rule can read
      </summary>
      <div className="mt-3 grid gap-grid md:grid-cols-2">
        {SUBJECT_NAMES.map((name) => (
          <div key={name} className="rounded-control border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <KindIcon kind={ICON_OF[name]} />
              <span className="mono text-ink">{name}</span>
              <span className="truncate text-muted">{SUBJECTS[name].description}</span>
            </div>
            <div className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted">
              {Object.entries(SUBJECTS[name].schema).map(([field, type]) => (
                <span key={field} className="whitespace-nowrap">
                  {field} <span className="text-faint">{type}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="rounded-control border border-line px-3 py-2.5 md:col-span-2">
          <div className="flex items-center gap-2">
            <span className="mono text-ink">estate</span>
            <span className="text-muted">The names the estate answers to, beside every subject, for `in`.</span>
          </div>
          <div className="mono mt-2 flex flex-wrap gap-x-3 text-muted">
            {["services", "contexts", "stores", "channels", "externals"].map((field) => (
              <span key={field} className="whitespace-nowrap">
                {field} <span className="text-faint">list&lt;string&gt;</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
