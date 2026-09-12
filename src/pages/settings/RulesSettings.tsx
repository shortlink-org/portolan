// The rules behind the Problems page, as a table with switches.
//
// Every row is one rule: the built-in readers with their passports from
// rules/builtin.json, then the estate's own, written in CEL in portolan.json.
// A reader sees what each checks, how many rows it produces right now, and
// what to do about one; in local mode they switch a rule off with a reason,
// re-grade it, or write a new one and watch it run over the catalog before
// it is saved. Nothing is written until the server has type-checked every
// expression against the same module the page checked it with.
//
// The page is laid out like the pipeline's plugin list - one bordered card,
// a muted group header, rows that open in place - so a reader who knows one
// settings tab knows this one. A row reads left to right the way a reader
// asks: is it on, what is it about, what is it called, how bad is a hit, how
// many hits are there now.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { catalog, index } from "../../data";
import { useToastStore } from "../../app/toast";
import { KindIcon } from "../../components/kind";
import { SectionTitle } from "../../components/PageHeader";
import { plural } from "../../lib/format";
import type { Kind } from "../../lib/kinds";
import { problemRules as readProblemRules, saveProblemRules } from "../../lib/local-api";
import {
  runCustomRule,
  SUBJECTS,
  useProblemRules,
  useRuleEntries,
} from "../../lib/problem-rules";
import type { ProblemRule, ProblemRuleEntry, RuleSeverity, RuleSubject } from "../../lib/problem-rules";
import { useProblemEvaluation } from "../../lib/use-problems";
import { paths } from "../../routes";

const FIELD = "mono w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
// A control that takes its own width: a filter beside other filters.
const CONTROL = "mono rounded-control border border-line bg-canvas px-2.5 py-1 text-ink outline-none focus:border-accent";
const SUBJECT_NAMES = Object.keys(SUBJECTS) as RuleSubject[];

/** The icon a rule wears: what one row of it is about. */
const ICON_OF: Record<RuleSubject, Kind> = {
  service: "service",
  call: "service",
  event: "event",
  channel: "event",
  table: "table",
  deployment: "service",
  flow: "flow",
  aggregate: "aggregate",
};

const SEVERITY_CHIP: Record<RuleSeverity, string> = {
  error: "chip status-unresolved",
  warning: "chip status-declared",
};

export function RulesSettings({ local }: { local: boolean }) {
  const say = useToastStore((s) => s.say);
  const rules = useProblemRules();
  const { matches, failures } = useProblemEvaluation();
  const entries = useRuleEntries((s) => s.entries);
  const setEntries = useRuleEntries((s) => s.setEntries);
  const [revision, setRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<"new" | string | null>(null);

  // The file on disk is the truth in local mode: the bundle's copy of the
  // manifest may be older than the server's, and a save must quote the
  // revision it read.
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    readProblemRules()
      .then((state) => {
        if (cancelled) return;
        setRevision(state.revision);
        setEntries(state.rules);
      })
      .catch((cause) => say(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [local, setEntries, say]);

  async function write(next: ProblemRuleEntry[], done: string) {
    if (!revision) return;
    setBusy(true);
    try {
      const saved = await saveProblemRules(revision, next);
      setRevision(saved.revision);
      setEntries(saved.rules);
      setEditing(null);
      say(done);
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

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
      onToggle={(enabled, reason) => void write(switched(entries, rule, enabled, reason), enabled ? `${rule.id} is on` : `${rule.id} is off`)}
      onSeverity={(next) => void write(regraded(entries, rule, next), `${rule.id} is now ${next}`)}
      {...(rule.builtin
        ? {}
        : {
            onEdit: () => setEditing(rule.id),
            onRemove: () => void write(entries.filter((entry) => entry.id !== rule.id), `${rule.id} is removed`),
          })}
    />
  );

  return (
    <section>
      <SectionTitle right={local ? "written to portolan.json after a type check" : "declared in portolan.json"}>Rules</SectionTitle>
      <p className="max-w-prose text-muted">
        What the Problems page looks for. A built-in rule is a reader over the merged catalog and can be switched off or re-graded here; a rule of your own is an
        expression over one subject, and runs in the page the moment it is saved.
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
              <button type="button" className="tbtn ml-auto normal-case" onClick={() => setEditing("new")} disabled={!canWrite || editing === "new"}>
                <Plus size={13} aria-hidden /> Add rule
              </button>
            ) : null}
          </h3>
          {editing === "new" ? (
            <div className="border-t border-line">
              <RuleEditor
                taken={new Set(rules.map((rule) => rule.id))}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(entry) => void write([...entries, entry], `${entry.id} is saved`)}
              />
            </div>
          ) : null}
          {custom.length === 0 && editing !== "new" ? (
            <p className="border-t border-line px-3 py-3 text-muted">
              {customTotal > 0
                ? "No rule of yours matches the filter."
                : local
                  ? "No rules of your own yet. A rule is one subject, a condition and a message; the built-in rows above show the shape."
                  : "portolan.json declares no rules of its own."}
            </p>
          ) : null}
          {custom.map((rule) =>
            editing === rule.id ? (
              <div key={rule.id} className="border-t border-line">
                <RuleEditor
                  initial={entries.find((entry) => entry.id === rule.id)}
                  taken={new Set(rules.filter((other) => other.id !== rule.id).map((other) => other.id))}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(entry) => void write(entries.map((existing) => (existing.id === rule.id ? entry : existing)), `${entry.id} is saved`)}
                />
              </div>
            ) : (
              row(rule)
            ),
          )}
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
// What a switch or a re-grade does to the manifest's entries.

/** The entries with one rule switched. A built-in rule back on with nothing else to say loses its entry. */
function switched(entries: ProblemRuleEntry[], rule: ProblemRule, enabled: boolean, reason: string): ProblemRuleEntry[] {
  const existing = entries.find((entry) => entry.id === rule.id);
  if (rule.builtin) {
    const next: ProblemRuleEntry = { id: rule.id };
    if (!enabled) next.enabled = false;
    if (existing?.severity) next.severity = existing.severity;
    const why = enabled ? existing?.reason : reason || existing?.reason;
    if (why && (!enabled || next.severity)) next.reason = why;
    if (enabled && !next.severity) return entries.filter((entry) => entry.id !== rule.id);
    return existing ? entries.map((entry) => (entry.id === rule.id ? next : entry)) : [...entries, next];
  }
  return entries.map((entry) => {
    if (entry.id !== rule.id) return entry;
    const { enabled: _enabled, ...rest } = entry;
    return enabled ? rest : { ...rest, enabled: false, ...(reason ? { reason } : {}) };
  });
}

/** The entries with one rule's severity set; a built-in back at its own severity loses the field. */
function regraded(entries: ProblemRuleEntry[], rule: ProblemRule, severity: RuleSeverity): ProblemRuleEntry[] {
  const existing = entries.find((entry) => entry.id === rule.id);
  if (rule.builtin) {
    const next: ProblemRuleEntry = { id: rule.id };
    if (existing?.enabled === false) next.enabled = false;
    if (severity !== rule.defaultSeverity) next.severity = severity;
    if (existing?.reason) next.reason = existing.reason;
    if (next.enabled === undefined && !next.severity) return entries.filter((entry) => entry.id !== rule.id);
    return existing ? entries.map((entry) => (entry.id === rule.id ? next : entry)) : [...entries, next];
  }
  return entries.map((entry) => (entry.id === rule.id ? { ...entry, severity } : entry));
}

// ---------------------------------------------------------------------------
// One rule.

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={disabled ? "local mode required" : label}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors disabled:cursor-default ${on ? "border-accent bg-accent" : "border-line-strong bg-canvas"}`}
    >
      <span aria-hidden className={`absolute top-0.5 size-2.5 rounded-full transition-transform ${on ? "translate-x-3.5 bg-canvas" : "translate-x-0.5 bg-line-strong"}`} />
    </button>
  );
}

function RuleRow({
  rule,
  count,
  failure,
  canWrite,
  onToggle,
  onSeverity,
  onEdit,
  onRemove,
}: {
  rule: ProblemRule;
  count: number;
  failure: string | undefined;
  canWrite: boolean;
  onToggle: (enabled: boolean, reason: string) => void;
  onSeverity: (severity: RuleSeverity) => void;
  onEdit?: () => void;
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
        <Switch on={rule.enabled} label={`${rule.enabled ? "Switch off" : "Switch on"} ${rule.id}`} disabled={!canWrite} onClick={toggle} />
        <KindIcon kind={ICON_OF[rule.over]} className={rule.enabled ? "" : "opacity-50"} />
        <button
          type="button"
          className="min-w-0 cursor-pointer text-left"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${rule.id}`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block truncate ${rule.enabled ? "text-ink" : "text-muted"}`}>{rule.title}</span>
          <span className="mono block truncate text-muted">
            {rule.id}
            <span className="text-faint"> · {rule.over}</span>
            {!rule.enabled ? <span className="text-faint"> · off{rule.reason ? ` — ${rule.reason}` : ""}</span> : null}
            {rule.enabled && regradedFrom ? <span className="text-faint"> · was {regradedFrom}</span> : null}
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
              <dt>kind</dt>
              <dd className="text-ink">{rule.builtin ? "built in, a reader in code" : "yours, in portolan.json"}</dd>
              {onEdit || onRemove ? (
                <>
                  <dt />
                  <dd className="flex flex-wrap gap-2">
                    {onEdit ? (
                      <button type="button" className="tbtn" onClick={onEdit} disabled={!canWrite}>
                        <Pencil size={13} aria-hidden /> Edit
                      </button>
                    ) : null}
                    {onRemove ? (
                      <button type="button" className="tbtn text-unresolved" onClick={onRemove} disabled={!canWrite}>
                        <Trash2 size={13} aria-hidden /> Remove
                      </button>
                    ) : null}
                  </dd>
                </>
              ) : null}
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
// Writing a rule, with the catalog answering as you type.

const RULE_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

function RuleEditor({
  initial,
  taken,
  busy,
  onCancel,
  onSave,
}: {
  initial?: ProblemRuleEntry;
  taken: Set<string>;
  busy: boolean;
  onCancel: () => void;
  onSave: (entry: ProblemRuleEntry) => void;
}) {
  const [draft, setDraft] = useState<ProblemRuleEntry>(() => ({
    id: initial?.id ?? "",
    title: initial?.title ?? "",
    over: initial?.over ?? "service",
    severity: initial?.severity ?? "warning",
    when: initial?.when ?? "",
    message: initial?.message ?? "",
    peer: initial?.peer ?? "",
    note: initial?.note ?? "",
    action: initial?.action ?? "",
    reason: initial?.reason ?? "",
    ...(initial?.enabled === false ? { enabled: false } : {}),
  }));
  const set = <K extends keyof ProblemRuleEntry>(key: K, value: ProblemRuleEntry[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
  const whenBox = useRef<HTMLTextAreaElement | null>(null);
  const subject = draft.over ?? "service";

  // A field chip drops `subject.field` where the cursor is in the condition,
  // which is how a reader learns the vocabulary without leaving the box.
  function insertField(field: string) {
    const box = whenBox.current;
    const text = draft.when ?? "";
    const token = `${subject}.${field}`;
    if (!box) {
      set("when", text ? `${text} ${token}` : token);
      return;
    }
    const start = box.selectionStart ?? text.length;
    const end = box.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const next = `${before}${before && !/\s$/.test(before) ? " " : ""}${token}${after && !/^\s/.test(after) ? " " : ""}${after}`;
    set("when", next);
    requestAnimationFrame(() => {
      box.focus();
      const at = next.length - after.length - (after && !/^\s/.test(after) ? 1 : 0);
      box.setSelectionRange(at, at);
    });
  }

  // The draft, run over the catalog on every keystroke: the count and the
  // first rows are how a reader learns whether the expression says what they
  // meant, before it is a rule.
  const preview = useMemo(() => {
    if (!draft.when?.trim() || !draft.message?.trim()) return null;
    const rule: ProblemRule = {
      id: draft.id || "draft",
      over: subject,
      severity: draft.severity ?? "warning",
      defaultSeverity: draft.severity ?? "warning",
      title: draft.title ?? "",
      note: draft.note ?? "",
      description: "",
      action: "",
      builtin: false,
      enabled: true,
      when: draft.when,
      message: draft.message,
      ...(draft.peer?.trim() ? { peer: draft.peer } : {}),
    };
    return runCustomRule(rule, catalog, index);
  }, [draft, subject]);

  const idProblem = !draft.id ? "required" : !RULE_ID.test(draft.id) ? "lower-case words joined by - or ." : taken.has(draft.id) ? "already a rule" : null;
  const ready = !idProblem && draft.title?.trim() && draft.when?.trim() && draft.message?.trim() && preview && !preview.failure;
  const fields = Object.entries(SUBJECTS[subject].schema);

  function save() {
    if (!ready) return;
    const entry: ProblemRuleEntry = {
      id: draft.id,
      over: subject,
      severity: draft.severity,
      title: draft.title!.trim(),
      when: draft.when!.trim(),
      message: draft.message!.trim(),
    };
    if (draft.peer?.trim()) entry.peer = draft.peer.trim();
    if (draft.note?.trim()) entry.note = draft.note.trim();
    if (draft.action?.trim()) entry.action = draft.action.trim();
    if (draft.reason?.trim()) entry.reason = draft.reason.trim();
    if (draft.enabled === false) entry.enabled = false;
    onSave(entry);
  }

  return (
    <form
      className="bg-surface/50 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium text-ink">{initial ? `Edit ${initial.id}` : "A rule of your own"}</div>
        <span className="mono text-muted">one subject · a condition · a message</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,1fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label mb-1.5 block">id</span>
              <input className={FIELD} value={draft.id} onChange={(event) => set("id", event.target.value)} placeholder="team.event-without-consumer" disabled={Boolean(initial)} spellCheck={false} />
              {idProblem && draft.id ? <span className="mono mt-1 block text-unresolved">{idProblem}</span> : null}
            </label>
            <label className="block">
              <span className="label mb-1.5 block">title</span>
              <input className={FIELD} value={draft.title ?? ""} onChange={(event) => set("title", event.target.value)} placeholder="Event nobody consumes" />
            </label>
            <label className="block">
              <span className="label mb-1.5 block">over</span>
              <select className={FIELD} value={subject} onChange={(event) => set("over", event.target.value as RuleSubject)}>
                {SUBJECT_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name} — {SUBJECTS[name].description}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label mb-1.5 block">severity</span>
              <select className={FIELD} value={draft.severity} onChange={(event) => set("severity", event.target.value as RuleSeverity)}>
                <option value="error">error</option>
                <option value="warning">warning</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label mb-1.5 flex items-baseline justify-between">
              <span>when · CEL returning bool</span>
              <span className="normal-case text-faint">a row for every {subject} where this holds</span>
            </span>
            <textarea ref={whenBox} className={`${FIELD} min-h-20 resize-y`} value={draft.when ?? ""} onChange={(event) => set("when", event.target.value)} placeholder={`size(${subject}.consumers) == 0`} spellCheck={false} />
          </label>
          <div>
            <div className="label mb-1.5">fields of {subject} · click to insert</div>
            <div className="flex flex-wrap gap-1">
              {fields.map(([name, type]) => (
                <button key={name} type="button" className="chip border-line-strong text-muted hover:border-accent hover:text-accent" onClick={() => insertField(name)} title={type}>
                  {name}
                  <span className="text-faint">{type.replace("list<string>", "[]")}</span>
                </button>
              ))}
              <span className="chip border-transparent text-faint">estate.services · contexts · stores · channels · externals</span>
            </div>
          </div>
          <label className="block">
            <span className="label mb-1.5 flex items-baseline justify-between">
              <span>message · CEL returning string</span>
              <span className="normal-case text-faint">the note on the row</span>
            </span>
            <textarea className={`${FIELD} min-h-12 resize-y`} value={draft.message ?? ""} onChange={(event) => set("message", event.target.value)} placeholder={`'nothing consumes ' + ${subject}.id`} spellCheck={false} />
          </label>
          <details className="group">
            <summary className="label flex cursor-pointer list-none items-center gap-1.5">
              <ChevronDown size={13} aria-hidden className="transition-transform group-open:rotate-180" /> more · peer, note, what to do, reason
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label mb-1.5 block">peer · CEL returning string</span>
                <input className={FIELD} value={draft.peer ?? ""} onChange={(event) => set("peer", event.target.value)} placeholder={`${subject}.service`} spellCheck={false} />
              </label>
              <label className="block">
                <span className="label mb-1.5 block">note · on every row</span>
                <input className={FIELD} value={draft.note ?? ""} onChange={(event) => set("note", event.target.value)} placeholder="an event with no consumer" />
              </label>
              <label className="block">
                <span className="label mb-1.5 block">what to do</span>
                <input className={FIELD} value={draft.action ?? ""} onChange={(event) => set("action", event.target.value)} placeholder="Subscribe a consumer or retire the event." />
              </label>
              <label className="block">
                <span className="label mb-1.5 block">reason · why the estate holds this rule</span>
                <input className={FIELD} value={draft.reason ?? ""} onChange={(event) => set("reason", event.target.value)} placeholder="every event should have a reader by the end of the quarter" />
              </label>
            </div>
          </details>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className={`rounded-control border px-3 py-3 ${preview?.failure ? "border-unresolved" : "border-line"} bg-canvas`}>
            <div className="label mb-2">what the catalog answers</div>
            {preview ? (
              preview.failure ? (
                <p className="mono text-unresolved">{preview.failure.message}</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="tnum text-lg leading-none text-ink">{preview.problems.length}</span>
                    <span className="mono text-muted">{plural(preview.problems.length, "row")} right now</span>
                  </div>
                  {preview.problems.length > 0 ? (
                    <ul className="mt-3 space-y-2 border-t border-line pt-3">
                      {preview.problems.slice(0, 6).map((problem) => (
                        <li key={problem.id} className="min-w-0">
                          <div className="mono truncate text-ink" title={problem.id}>
                            {problem.id}
                            {problem.peer ? <span className="text-muted"> → {problem.peer}</span> : null}
                          </div>
                          <div className="truncate text-muted" title={problem.note}>
                            {problem.note}
                          </div>
                        </li>
                      ))}
                      {preview.problems.length > 6 ? <li className="mono text-faint">+ {preview.problems.length - 6} more</li> : null}
                    </ul>
                  ) : (
                    <p className="mt-2 text-muted">Nothing in the catalog matches. That may be the point, or the condition may be too tight.</p>
                  )}
                </>
              )
            ) : (
              <p className="text-muted">Write a condition and a message, and the rows they would produce appear here before anything is saved.</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" className="product-primary" disabled={!ready || busy}>
              {initial ? "Save rule" : "Add rule"}
            </button>
            <button type="button" className="tbtn py-1.5" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </form>
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
