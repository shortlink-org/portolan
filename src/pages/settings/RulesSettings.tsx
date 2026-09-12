// The rules behind the Problems page, as a table with switches.
//
// Every row is one rule: the built-in readers with their passports from
// rules/builtin.json, then the estate's own, written in CEL in portolan.json.
// A reader sees what each checks, how many rows it produces right now, and
// what to do about one; in local mode they switch a rule off with a reason,
// re-grade it, or write a new one and watch it run over the catalog before
// it is saved. Nothing is written until the server has type-checked every
// expression against the same module the page checked it with.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { catalog, index } from "../../data";
import { useToastStore } from "../../app/toast";
import { plural } from "../../lib/format";
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
const CONTROL = "mono rounded-control border border-line bg-canvas px-3 py-1 text-ink outline-none focus:border-accent";
const SUBJECT_NAMES = Object.keys(SUBJECTS) as RuleSubject[];

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
  const builtin = shown.filter((rule) => rule.builtin);
  const custom = shown.filter((rule) => !rule.builtin);
  const customTotal = rules.filter((rule) => !rule.builtin).length;
  const off = rules.filter((rule) => !rule.enabled).length;
  const canWrite = local && revision !== null && !busy;

  return (
    <section className="space-y-section">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">Rules</h2>
          <span className="mono text-muted">{local ? "written to portolan.json after a type check" : "declared in portolan.json"}</span>
        </div>
        <p className="max-w-prose text-muted">
          What the Problems page looks for. A built-in rule is a reader over the merged catalog and can be switched off or re-graded here; a rule of your own is
          an expression over one subject, and runs in the page the moment it is saved.
        </p>
        <div className="mono mt-3 flex flex-wrap gap-3 text-muted">
          <span>
            <span className="tnum text-ink">{rules.length}</span> {plural(rules.length, "rule")}
          </span>
          <span>
            <span className="tnum text-ink">{customTotal}</span> yours
          </span>
          {off > 0 ? (
            <span>
              <span className="tnum text-ink">{off}</span> off
            </span>
          ) : null}
          {failures.length > 0 ? (
            <span className="text-unresolved">
              <span className="tnum">{failures.length}</span> {plural(failures.length, "rule")} could not run
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Find a rule"
          className={`${CONTROL} min-w-48`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="find by id or title"
          spellCheck={false}
        />
        <select aria-label="Filter rules by subject" className={`${CONTROL}`} value={over} onChange={(event) => setOver(event.target.value as RuleSubject | "all")}>
          <option value="all">all subjects</option>
          {SUBJECT_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Filter rules by severity" className={`${CONTROL}`} value={severity} onChange={(event) => setSeverity(event.target.value as RuleSeverity | "all")}>
          <option value="all">all severities</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
        </select>
        <select aria-label="Filter rules by switch" className={`${CONTROL}`} value={state} onChange={(event) => setState(event.target.value as "all" | "on" | "off")}>
          <option value="all">on and off</option>
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
        <select aria-label="Filter rules by rows" className={`${CONTROL}`} value={rows} onChange={(event) => setRows(event.target.value as "all" | "with" | "without")}>
          <option value="all">with and without rows</option>
          <option value="with">with rows</option>
          <option value="without">without rows</option>
        </select>
        {filtered ? (
          <span className="mono text-muted">
            {shown.length} of {rules.length}
            <button
              type="button"
              className="tbtn ml-2 py-0.5"
              onClick={() => {
                setQuery("");
                setOver("all");
                setSeverity("all");
                setState("all");
                setRows("all");
              }}
            >
              clear
            </button>
          </span>
        ) : null}
      </div>

      <div>
        <div className="label mb-2">built in</div>
        {builtin.length === 0 ? <p className="mono text-muted">No built-in rule matches the filter.</p> : null}
        <div className="space-y-1">
          {builtin.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              count={matches.get(rule.id) ?? 0}
              failure={failures.find((failure) => failure.rule === rule.id)?.message}
              canWrite={canWrite}
              onToggle={(enabled, reason) => void write(switched(entries, rule, enabled, reason), enabled ? `${rule.id} is on` : `${rule.id} is off`)}
              onSeverity={(severity) => void write(regraded(entries, rule, severity), `${rule.id} is now ${severity}`)}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label">yours</div>
          {local ? (
            <button type="button" className="tbtn" onClick={() => setEditing("new")} disabled={!canWrite || editing === "new"}>
              <Plus size={14} aria-hidden /> Add rule
            </button>
          ) : null}
        </div>
        {editing === "new" ? (
          <RuleEditor
            taken={new Set(rules.map((rule) => rule.id))}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(entry) => void write([...entries, entry], `${entry.id} is saved`)}
          />
        ) : null}
        {custom.length === 0 && editing !== "new" ? (
          <p className="mono text-muted">
            {customTotal > 0
              ? "No rule of yours matches the filter."
              : local
                ? "No rules of your own yet. A rule is one subject, a condition and a message; the built-in rows above show the shape."
                : "portolan.json declares no rules of its own."}
          </p>
        ) : null}
        <div className="space-y-1">
          {custom.map((rule) =>
            editing === rule.id ? (
              <RuleEditor
                key={rule.id}
                initial={entries.find((entry) => entry.id === rule.id)}
                taken={new Set(rules.filter((other) => other.id !== rule.id).map((other) => other.id))}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={(entry) => void write(entries.map((existing) => (existing.id === rule.id ? entry : existing)), `${entry.id} is saved`)}
              />
            ) : (
              <RuleRow
                key={rule.id}
                rule={rule}
                count={matches.get(rule.id) ?? 0}
                failure={failures.find((failure) => failure.rule === rule.id)?.message}
                canWrite={canWrite}
                onToggle={(enabled, reason) => void write(switched(entries, rule, enabled, reason), enabled ? `${rule.id} is on` : `${rule.id} is off`)}
                onSeverity={(severity) => void write(regraded(entries, rule, severity), `${rule.id} is now ${severity}`)}
                onEdit={() => setEditing(rule.id)}
                onRemove={() => void write(entries.filter((entry) => entry.id !== rule.id), `${rule.id} is removed`)}
              />
            ),
          )}
        </div>
      </div>

      <SubjectReference />
    </section>
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
    <div id={`rule-${rule.id}`} className={`rounded-control border px-3 py-2 ${rule.enabled ? (failure ? "border-unresolved" : "border-line") : "border-line opacity-75"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.enabled ? "Switch off" : "Switch on"} ${rule.id}`}
          title={canWrite ? (rule.enabled ? "Switch off" : "Switch on") : "local mode required"}
          disabled={!canWrite}
          onClick={toggle}
          className={`relative h-4 w-7 shrink-0 rounded-full border transition-colors disabled:cursor-default ${rule.enabled ? "border-accent bg-accent" : "border-line-strong bg-canvas"}`}
        >
          <span aria-hidden className={`absolute top-0.5 size-2.5 rounded-full bg-canvas transition-transform ${rule.enabled ? "translate-x-3.5 bg-white" : "translate-x-0.5 bg-line-strong"}`} />
        </button>
        <span className={`chip ${rule.severity === "error" ? "status-unresolved" : "status-declared"}`} title={regradedFrom ? `re-graded from ${regradedFrom}` : undefined}>
          {rule.severity}
          {regradedFrom ? "*" : ""}
        </span>
        <span className="font-medium text-ink">{rule.title}</span>
        <span className="mono text-muted">{rule.id}</span>
        <span className="chip border-line-strong text-muted">{rule.over}</span>
        <span className="mono ml-auto flex items-center gap-2 text-muted">
          {failure ? (
            <span className="text-unresolved">could not run</span>
          ) : count > 0 ? (
            <Link to={`${paths.problems()}?rule=${encodeURIComponent(rule.id)}`} className="hover:underline" title={rule.enabled ? "Rows on the Problems page" : "Rows this rule would produce if switched on"}>
              <span className="tnum">{count}</span> {plural(count, "row")}
            </Link>
          ) : (
            <span>no rows</span>
          )}
          <button type="button" className="tbtn p-1" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${rule.id}`} onClick={() => setOpen((v) => !v)}>
            <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </span>
      </div>
      {open ? (
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-muted">
          {rule.description ? <p className="max-w-prose">{rule.description}</p> : null}
          {rule.action ? (
            <p className="max-w-prose">
              <span className="text-ink">What to do:</span> {rule.action}
            </p>
          ) : null}
          {rule.when ? <Expression label="when" source={rule.when} /> : null}
          {rule.message ? <Expression label="message" source={rule.message} /> : null}
          {rule.peer ? <Expression label="peer" source={rule.peer} /> : null}
          {failure ? <p className="mono text-unresolved">{failure}</p> : null}
          {rule.reason ? (
            <p className="max-w-prose">
              <span className="text-ink">Reason:</span> {rule.reason}
            </p>
          ) : null}
          {askingReason ? (
            <form
              className="flex flex-wrap items-end gap-2"
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
              <button type="button" className="tbtn" onClick={() => setAskingReason(false)}>
                Keep on
              </button>
            </form>
          ) : null}
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <span className="label">severity</span>
                <select className={`${CONTROL}`} value={rule.severity} onChange={(event) => onSeverity(event.target.value as RuleSeverity)}>
                  <option value="error">error</option>
                  <option value="warning">warning</option>
                </select>
              </label>
              {onEdit ? (
                <button type="button" className="tbtn" onClick={onEdit}>
                  <Pencil size={14} aria-hidden /> Edit
                </button>
              ) : null}
              {onRemove ? (
                <button type="button" className="tbtn text-unresolved" onClick={onRemove}>
                  <Trash2 size={14} aria-hidden /> Remove
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Expression({ label, source }: { label: string; source: string }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <pre className="mono overflow-x-auto rounded-control border border-line bg-canvas px-3 py-2 text-ink whitespace-pre-wrap">{source}</pre>
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

  // The draft, run over the catalog on every keystroke: the count and the
  // first rows are how a reader learns whether the expression says what they
  // meant, before it is a rule.
  const preview = useMemo(() => {
    if (!draft.when?.trim() || !draft.message?.trim()) return null;
    const rule: ProblemRule = {
      id: draft.id || "draft",
      over: draft.over ?? "service",
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
  }, [draft]);

  const idProblem = !draft.id ? "required" : !RULE_ID.test(draft.id) ? "lower-case words joined by - or ." : taken.has(draft.id) ? "already a rule" : null;
  const ready = !idProblem && draft.title?.trim() && draft.when?.trim() && draft.message?.trim() && preview && !preview.failure;
  const fields = Object.entries(SUBJECTS[draft.over ?? "service"].schema);

  function save() {
    if (!ready) return;
    const entry: ProblemRuleEntry = {
      id: draft.id,
      over: draft.over,
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
      className="mb-2 space-y-3 rounded-control border border-accent bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1.5 block">id</span>
          <input className={FIELD} value={draft.id} onChange={(event) => set("id", event.target.value)} placeholder="team.event-without-consumer" disabled={Boolean(initial)} />
          {idProblem && draft.id ? <span className="mono mt-1 block text-unresolved">{idProblem}</span> : null}
        </label>
        <label className="block">
          <span className="label mb-1.5 block">title</span>
          <input className={FIELD} value={draft.title ?? ""} onChange={(event) => set("title", event.target.value)} placeholder="Event nobody consumes" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">over</span>
          <select className={FIELD} value={draft.over} onChange={(event) => set("over", event.target.value as RuleSubject)}>
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
        <span className="label mb-1.5 block">when · CEL returning bool</span>
        <textarea className={`${FIELD} min-h-16 resize-y`} value={draft.when ?? ""} onChange={(event) => set("when", event.target.value)} placeholder={`size(${draft.over}.consumers) == 0`} spellCheck={false} />
      </label>
      <label className="block">
        <span className="label mb-1.5 block">message · CEL returning string</span>
        <textarea className={`${FIELD} min-h-12 resize-y`} value={draft.message ?? ""} onChange={(event) => set("message", event.target.value)} placeholder={`'nothing consumes ' + ${draft.over}.id`} spellCheck={false} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-1.5 block">peer · CEL returning string, optional</span>
          <input className={FIELD} value={draft.peer ?? ""} onChange={(event) => set("peer", event.target.value)} placeholder={`${draft.over}.service`} spellCheck={false} />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">note · on every row, optional</span>
          <input className={FIELD} value={draft.note ?? ""} onChange={(event) => set("note", event.target.value)} placeholder="an event with no consumer" />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">what to do · optional</span>
          <input className={FIELD} value={draft.action ?? ""} onChange={(event) => set("action", event.target.value)} placeholder="Subscribe a consumer or retire the event." />
        </label>
        <label className="block">
          <span className="label mb-1.5 block">reason · why the estate holds this rule, optional</span>
          <input className={FIELD} value={draft.reason ?? ""} onChange={(event) => set("reason", event.target.value)} placeholder="every event should have a reader by the end of the quarter" />
        </label>
      </div>
      <div className="mono text-faint">
        fields of {draft.over}: {fields.map(([name, type]) => `${name} ${type}`).join(" · ")} · estate: services, contexts, stores, channels, externals
      </div>
      {preview ? (
        preview.failure ? (
          <p className="mono text-unresolved">{preview.failure.message}</p>
        ) : (
          <div className="rounded-control border border-line bg-canvas px-3 py-2">
            <div className="mono text-muted">
              <span className="tnum text-ink">{preview.problems.length}</span> {plural(preview.problems.length, "row")} right now
            </div>
            {preview.problems.slice(0, 5).map((problem) => (
              <div key={problem.id} className="mono mt-1 truncate text-muted" title={problem.note}>
                <span className="text-ink">{problem.id}</span>
                {problem.peer ? ` → ${problem.peer}` : ""} · {problem.note}
              </div>
            ))}
            {preview.problems.length > 5 ? <div className="mono mt-1 text-faint">+ {preview.problems.length - 5} more</div> : null}
          </div>
        )
      ) : (
        <p className="mono text-faint">a condition and a message, and the catalog answers here</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="product-primary" disabled={!ready || busy}>
          {initial ? "Save rule" : "Add rule"}
        </button>
        <button type="button" className="tbtn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// What an expression may read.

function SubjectReference() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" className="tbtn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={14} aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`} /> What a rule can read
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {SUBJECT_NAMES.map((name) => (
            <div key={name} className="rounded-control border border-line px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="mono text-ink">{name}</span>
                <span className="text-muted">{SUBJECTS[name].description}</span>
              </div>
              <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
                {Object.entries(SUBJECTS[name].schema).map(([field, type]) => (
                  <span key={field}>
                    {field} <span className="text-faint">{type}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-control border border-line px-3 py-2 md:col-span-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="mono text-ink">estate</span>
              <span className="text-muted">The names the estate answers to, for `in`.</span>
            </div>
            <div className="mono mt-1 flex flex-wrap gap-x-3 text-muted">
              {["services", "contexts", "stores", "channels", "externals"].map((field) => (
                <span key={field}>
                  {field} <span className="text-faint">list&lt;string&gt;</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
