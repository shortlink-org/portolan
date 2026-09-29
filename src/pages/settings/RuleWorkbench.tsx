// One rule, and what the catalog says to it.
//
// The page answers one question: does this rule say what I meant? The rule
// is written as one sentence - flag every event where this holds, as an
// error - and the answer is the list under it: the rows it matches, the rows
// it leaves out, and, while an existing rule is being edited, the rows the
// edit adds or drops. Opening a row shows the fields the condition read and
// lights the one that decided it (rule-why.ts), and keeps the row as an
// example, which is how a rule gets its tests without anyone writing JSON.
//
// Everything else a rule carries - the message, what to do, the reason, the
// far end - is behind one disclosure; a first rule needs none of it. The
// footer is the only place that writes: the examples' verdict, discard, save.
// A shipped rule opens here too, read-only, for its rows and their reasons;
// it is switched and re-graded on the list.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, ChevronDown, ExternalLink, Trash2, X } from "lucide-react";
import { catalog, index } from "../../data";
import { KindIcon } from "../../components/kind";
import { ICON_OF, nearPath } from "../../components/ProblemRow";
import { Empty } from "../../components/PageHeader";
import type { Problem } from "../../lib/derive";
import { plural } from "../../lib/format";
import { estateOf, evaluateRows, SUBJECTS, useProblemRules } from "../../lib/problem-rules";
import type { ProblemRule, ProblemRuleEntry, RowVerdict, RuleExample, RuleSeverity, RuleSubject } from "../../lib/problem-rules";
import { RULE_ID } from "../../lib/problem-rules-cel.mjs";
import { diffRows, rowKey } from "../../lib/rule-diff";
import { exampleOfRow, freshExampleName, runExamples } from "../../lib/rule-examples";
import type { ExampleResult } from "../../lib/rule-examples";
import { shownValue, whyOf } from "../../lib/rule-why";
import type { FieldWhy } from "../../lib/rule-why";
import { sourceHref } from "../../lib/source-link";
import { useRuleFile } from "../../lib/use-rule-file";
import { paths } from "../../routes";
import { CelInput } from "./CelInput";

const SUBJECT_NAMES = Object.keys(SUBJECTS) as RuleSubject[];
const FIELD = "w-full rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
/** How many rows the list shows before it asks. */
const FIRST = 50;

type Filter = "match" | "none" | "changed";

/** The draft as the page edits it: every text field a string, so inputs stay controlled. */
interface Draft {
  id: string;
  title: string;
  over: RuleSubject;
  severity: RuleSeverity;
  when: string;
  message: string;
  peer: string;
  note: string;
  action: string;
  reason: string;
  enabled: boolean;
  examples: RuleExample[];
}

function draftOf(entry: ProblemRuleEntry | undefined, rule: ProblemRule | undefined): Draft {
  const from = entry ?? rule;
  return {
    id: from?.id ?? "",
    title: from?.title ?? "",
    over: from?.over ?? "service",
    severity: from?.severity ?? "warning",
    when: from?.when ?? "",
    message: from?.message ?? "",
    peer: from?.peer ?? "",
    note: from?.note ?? "",
    action: from?.action ?? "",
    reason: from?.reason ?? "",
    enabled: entry ? entry.enabled !== false : (rule?.enabled ?? true),
    examples: from?.examples ?? [],
  };
}

/** The entry a draft saves as. An empty message says the rule's title. */
function entryOf(draft: Draft): ProblemRuleEntry {
  const entry: ProblemRuleEntry = {
    id: draft.id,
    over: draft.over,
    severity: draft.severity,
    title: draft.title.trim(),
    when: draft.when.trim(),
    message: draft.message.trim() || JSON.stringify(draft.title.trim()),
  };
  if (draft.peer.trim()) entry.peer = draft.peer.trim();
  if (draft.note.trim()) entry.note = draft.note.trim();
  if (draft.action.trim()) entry.action = draft.action.trim();
  if (draft.reason.trim()) entry.reason = draft.reason.trim();
  if (!draft.enabled) entry.enabled = false;
  if (draft.examples.length > 0) entry.examples = draft.examples;
  return entry;
}

/** An id from a title, for a new rule whose author has not typed one. */
function idOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function RuleWorkbench({ local }: { local: boolean }) {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const rules = useProblemRules();
  const file = useRuleFile(local);
  const rule = isNew ? undefined : rules.find((candidate) => candidate.id === id);

  if (!isNew && !rule) {
    return (
      <section>
        <BackToRules />
        <Empty>
          No rule is called <span className="mono text-ink">{id}</span>. It may have been renamed or removed from portolan.json.
        </Empty>
      </section>
    );
  }
  // Keyed on the rule, so moving from one rule to another starts a fresh draft.
  return <Workbench key={isNew ? "new" : id} rule={rule} local={local} file={file} rules={rules} />;
}

function BackToRules() {
  return (
    <Link to={paths.settingsRules()} className="mono text-muted hover:text-ink">
      ← all rules
    </Link>
  );
}

function Workbench({
  rule,
  local,
  file,
  rules,
}: {
  rule: ProblemRule | undefined;
  local: boolean;
  file: ReturnType<typeof useRuleFile>;
  rules: ProblemRule[];
}) {
  const navigate = useNavigate();
  const builtin = rule?.builtin ?? false;
  const savedEntry = rule && !builtin ? file.entries.find((entry) => entry.id === rule.id) : undefined;
  const initial = useMemo(() => draftOf(savedEntry, rule), [savedEntry, rule]);
  const [draft, setDraft] = useState<Draft>(initial);
  // The file on disk arrives after the first render, and a save writes a new
  // one: an untouched draft follows it, an edited one is left alone.
  const [base, setBase] = useState(initial);
  if (JSON.stringify(base) !== JSON.stringify(initial)) {
    setBase(initial);
    if (JSON.stringify(draft) === JSON.stringify(base)) setDraft(initial);
  }
  const [idTouched, setIdTouched] = useState(Boolean(rule));
  const [more, setMore] = useState(false);
  const [picked, setFilter] = useState<Filter>("match");
  const [shown, setShown] = useState(FIRST);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const editable = local && !builtin;
  const canWrite = editable && file.revision !== null && !file.busy;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  const estate = useMemo(() => estateOf(catalog), []);
  const draftRun = useMemo(
    () => evaluateRows({ over: draft.over, when: draft.when, message: draft.message }, catalog, index, estate),
    [draft.over, draft.when, draft.message, estate],
  );
  const savedRun = useMemo(
    () => (rule && !builtin ? evaluateRows(rule, catalog, index, estate) : null),
    [rule, builtin, estate],
  );
  const diff = useMemo(
    () => (savedRun && !savedRun.failure && !draftRun.failure && savedRun.rows.length > 0 && rule?.over === draft.over ? diffRows(savedRun.rows, draftRun.rows) : null),
    [savedRun, draftRun, rule, draft.over],
  );
  const changedCount = diff ? diff.added.size + diff.gone.size : 0;
  // The changed tab goes when the edit is undone; the list falls back to the matches.
  const filter: Filter = picked === "changed" && changedCount === 0 ? "match" : picked;
  const matched = draftRun.rows.filter((row) => row.matched);
  const unmatched = draftRun.rows.filter((row) => !row.matched);
  const listed =
    filter === "match" ? matched : filter === "none" ? unmatched : draftRun.rows.filter((row) => diff?.added.has(rowKey(row)) || diff?.gone.has(rowKey(row)));
  const results = useMemo(
    () => (draft.when.trim() && !draftRun.failure ? runExamples(draft.over, draft.when, draft.examples) : []),
    [draft.over, draft.when, draft.examples, draftRun.failure],
  );
  const failing = results.filter((result) => !result.holds).length;

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const taken = new Set(["new", ...rules.filter((other) => other.id !== rule?.id).map((other) => other.id)]);
  const blocker = !draft.title.trim()
    ? "Name the rule"
    : !draft.id
      ? "Give the rule an id"
      : !RULE_ID.test(draft.id)
        ? "The id is lower-case words joined by - or ."
        : taken.has(draft.id)
          ? `${draft.id} is already a rule`
          : !draft.when.trim()
            ? "Write the condition"
            : draftRun.failure
              ? "The condition does not compile"
              : failing > 0
                ? `${failing} ${plural(failing, "example")} ${failing === 1 ? "disagrees" : "disagree"} with the rule`
                : null;

  function setTitle(title: string) {
    setDraft((prev) => ({ ...prev, title, ...(idTouched ? {} : { id: idOf(title) }) }));
  }

  function keep(verdict: RowVerdict) {
    const expect = verdict.matched ? "row" : "none";
    const name = freshExampleName(verdict.subject.id || draft.over, draft.examples);
    set("examples", [...draft.examples, exampleOfRow(draft.over, draft.when, verdict.subject.row, estate, expect, name)]);
  }

  async function save() {
    if (blocker || !canWrite) return;
    const entry = entryOf(draft);
    const next = rule ? file.entries.map((existing) => (existing.id === rule.id ? entry : existing)) : [...file.entries, entry];
    const ok = await file.write(next, `${entry.id} is saved`);
    if (!ok) return;
    // What was saved is the draft now: an empty message was filled with the title.
    setDraft(draftOf(entry, undefined));
    if (!rule) navigate(paths.settingsRule(entry.id), { replace: true });
  }

  return (
    <section>
      <BackToRules />

      {/* Identity: the name a reader will see on every row, and the id the manifest keys it by. */}
      <div className="mt-4">
        {editable ? (
          // A one-line box that wraps, so a long name stays readable on a phone.
          <textarea
            aria-label="Rule title"
            rows={1}
            className="block w-full resize-none bg-transparent text-xl font-semibold text-ink outline-none [field-sizing:content] placeholder:text-faint"
            value={draft.title}
            onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="Name the rule"
          />
        ) : (
          <h2 className="text-xl font-semibold text-ink">{draft.title}</h2>
        )}
        {editable && !rule ? (
          <input
            aria-label="Rule id"
            className="mono mt-1 w-full max-w-md bg-transparent text-muted outline-none placeholder:text-faint"
            value={draft.id}
            onChange={(event) => {
              setIdTouched(true);
              set("id", event.target.value);
            }}
            placeholder="team.rule-id"
            spellCheck={false}
          />
        ) : (
          <div className="mono mt-1 text-muted">
            {draft.id}
            {builtin ? <span className="text-faint"> · built in, switched and re-graded on the list</span> : null}
            {!draft.enabled ? <span className="text-faint"> · off</span> : null}
          </div>
        )}
        {builtin && rule?.description ? <p className="mt-3 max-w-prose text-muted">{rule.description}</p> : null}
      </div>

      {/* The rule as one sentence. */}
      <div className="mt-6 max-w-table">
        <div className="flex flex-wrap items-center gap-2 text-md text-ink">
          <span>Flag every</span>
          {editable ? (
            <select
              aria-label="Subject"
              className="mono rounded-control border border-line-strong bg-canvas px-2 py-1 text-ink outline-none focus:border-accent"
              value={draft.over}
              onChange={(event) => set("over", event.target.value as RuleSubject)}
              title={SUBJECTS[draft.over].description}
            >
              {SUBJECT_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono inline-flex items-center gap-1.5 rounded-control border border-line px-2 py-1">
              <KindIcon kind={ICON_OF[draft.over]} size={12} /> {draft.over}
            </span>
          )}
          <span>where</span>
        </div>
        <div className="mt-2">
          <CelInput
            subject={draft.over}
            label="Condition, CEL returning bool"
            value={draft.when}
            onChange={(next) => set("when", next)}
            placeholder={`size(${draft.over}.${Object.keys(SUBJECTS[draft.over].schema).find((field) => SUBJECTS[draft.over].schema[field] === "list<string>") ?? "id"}) == 0`}
            error={draft.when.trim() ? draftRun.failure : undefined}
            readOnly={!editable}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-md text-ink">
          <span>as</span>
          {editable ? (
            <div className="seg" role="group" aria-label="Severity">
              {(["warning", "error"] as const).map((severity) => (
                <button
                  key={severity}
                  type="button"
                  aria-pressed={draft.severity === severity}
                  className={draft.severity === severity ? "is-on" : ""}
                  onClick={() => set("severity", severity)}
                >
                  {severity}
                </button>
              ))}
            </div>
          ) : (
            <span className={`chip ${draft.severity === "error" ? "status-unresolved" : "status-declared"}`}>{draft.severity}</span>
          )}
          <button type="button" className="mono ml-2 flex items-center gap-1 text-muted hover:text-ink" aria-expanded={more} onClick={() => setMore((v) => !v)}>
            message, what to do, reason
            <ChevronDown size={13} aria-hidden className={`transition-transform ${more ? "rotate-180" : ""}`} />
          </button>
        </div>
        {more ? <MoreFields draft={draft} set={set} editable={editable} /> : null}
      </div>

      {/* The answer. */}
      <div className="mt-section">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="text-md text-ink" aria-live="polite">
            {draftRun.failure || !draft.when.trim() ? (
              <span className="text-muted">Write a condition, and the {draft.over} rows it matches appear here.</span>
            ) : (
              <>
                <span className="tnum font-semibold">{matched.length}</span> {plural(matched.length, draft.over)}{" "}
                <span className="text-muted">
                  {matched.length === 1 ? "matches" : "match"} of {draftRun.rows.length}
                </span>
              </>
            )}
          </div>
          {!draftRun.failure && draft.when.trim() ? (
            <div className="seg" role="group" aria-label="Rows to list">
              <FilterTab on={filter === "match"} onClick={() => setFilter("match")} label="match" count={matched.length} />
              <FilterTab on={filter === "none"} onClick={() => setFilter("none")} label="don't" count={unmatched.length} />
              {changedCount > 0 ? <FilterTab on={filter === "changed"} onClick={() => setFilter("changed")} label="changed" count={changedCount} /> : null}
            </div>
          ) : null}
        </div>

        {!draftRun.failure && draft.when.trim() ? (
          listed.length === 0 ? (
            <p className="mt-3 text-muted">
              {filter === "match"
                ? "Nothing in the catalog matches. That may be the point, or the condition may be too tight."
                : filter === "none"
                  ? `The condition matches every ${draft.over}.`
                  : "The edit changes no row."}
            </p>
          ) : (
            <div className="mt-3 max-w-table border-b border-line">
              {listed.slice(0, shown).map((verdict) => {
                const key = rowKey(verdict);
                return (
                  <VerdictRow
                    key={key}
                    over={draft.over}
                    when={draft.when}
                    verdict={verdict}
                    title={draft.title.trim()}
                    estate={estate}
                    change={diff?.added.has(key) ? "new" : diff?.gone.has(key) ? "gone" : null}
                    open={openRow === key}
                    onToggle={() => setOpenRow((current) => (current === key ? null : key))}
                    {...(editable ? { onKeep: () => keep(verdict) } : {})}
                  />
                );
              })}
              {listed.length > shown ? (
                <div className="border-t border-line py-2">
                  <button type="button" className="tbtn" onClick={() => setShown(listed.length)}>
                    Show all {listed.length}
                  </button>
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {editable ? (
        <Footer
          results={results}
          onRemove={(name) => set("examples", draft.examples.filter((example) => example.name !== name))}
          blocker={blocker}
          dirty={dirty}
          canWrite={canWrite}
          busy={file.busy}
          readingFile={file.revision === null}
          onDiscard={() => (rule ? setDraft(initial) : navigate(paths.settingsRules()))}
          onSave={() => void save()}
        />
      ) : null}
    </section>
  );
}

function FilterTab({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" aria-pressed={on} className={on ? "is-on" : ""} onClick={onClick}>
      {label} <span className="tnum">{count}</span>
    </button>
  );
}

function MoreFields({ draft, set, editable }: { draft: Draft; set: <K extends keyof Draft>(key: K, value: Draft[K]) => void; editable: boolean }) {
  return (
    <div className="mt-4 grid gap-4 border-l-2 border-line pl-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <div className="label mb-1.5">message · CEL returning string · the rule's title when empty</div>
        <CelInput
          subject={draft.over}
          label="Message, CEL returning string"
          value={draft.message}
          onChange={(next) => set("message", next)}
          placeholder={`${draft.over}.id + ' has no reader'`}
          rows={1}
          readOnly={!editable}
        />
      </div>
      <label className="block">
        <span className="label mb-1.5 block">what to do about a row</span>
        <input className={FIELD} value={draft.action} onChange={(event) => set("action", event.target.value)} placeholder="Replace the address with an opaque customer id." readOnly={!editable} />
      </label>
      <label className="block">
        <span className="label mb-1.5 block">why the estate holds this rule</span>
        <input className={FIELD} value={draft.reason} onChange={(event) => set("reason", event.target.value)} placeholder="Events are kept for years; personal data is not." readOnly={!editable} />
      </label>
      <label className="block">
        <span className="label mb-1.5 block">note · the short words on every row</span>
        <input className={FIELD} value={draft.note} onChange={(event) => set("note", event.target.value)} placeholder="personal data in an event" readOnly={!editable} />
      </label>
      <div>
        <div className="label mb-1.5">far end · CEL returning string</div>
        <CelInput subject={draft.over} label="Far end, CEL returning string" value={draft.peer} onChange={(next) => set("peer", next)} placeholder={`${draft.over}.service`} rows={1} readOnly={!editable} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row of the answer.

function VerdictRow({
  over,
  when,
  verdict,
  title,
  estate,
  change,
  open,
  onToggle,
  onKeep,
}: {
  over: RuleSubject;
  when: string;
  verdict: RowVerdict;
  /** The rule's title: a note that only repeats it is left off the row. */
  title: string;
  estate: Record<string, string[]>;
  change: "new" | "gone" | null;
  open: boolean;
  onToggle: () => void;
  onKeep?: () => void;
}) {
  const { subject } = verdict;
  const near = nearPath(over, { id: subject.id, service: subject.service } as Problem);
  const service = subject.service ? index.serviceById.get(subject.service) : undefined;
  const source = subject.source ? sourceHref(subject.source, service) : null;
  const why = useMemo(() => (open ? whyOf(over, when, subject.row, estate) : null), [open, over, when, subject.row, estate]);

  return (
    <div className="border-t border-line">
      <button
        type="button"
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-baseline gap-x-3 py-2.5 text-left hover:bg-surface/60"
        onClick={onToggle}
      >
        <KindIcon kind={ICON_OF[over]} className="self-center" />
        <span className="min-w-0 truncate">
          <span className={`mono ${change === "gone" ? "text-muted line-through" : "text-ink"}`}>{subject.id}</span>
          {verdict.note && verdict.note !== title ? <span className="text-muted"> · {verdict.note}</span> : null}
          {change ? <span className="chip ml-2 border-line-strong text-muted">{change === "new" ? "new" : "no longer matches"}</span> : null}
        </span>
        <span className="mono hidden text-faint sm:block">{subject.service}</span>
        <ChevronDown size={14} aria-hidden className={`self-center text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && why ? (
        <div className="mb-3 ml-1 border-l-2 border-accent pl-4">
          {why.fields.length === 0 ? (
            <p className="text-muted">The condition reads no field of the {over}.</p>
          ) : (
            <dl className="mono grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              {why.fields.map((field) => (
                <FieldLine key={field.field} why={field} value={subject.row[field.field]} joint={why.joint} />
              ))}
            </dl>
          )}
          {why.joint ? <p className="mt-2 text-muted">No one field decides alone; these take part together.</p> : null}
          {!why.outcome && why.fields.length > 0 && !why.fields.some((field) => field.decisive) ? (
            <p className="mt-2 text-muted">These values do not meet the condition.</p>
          ) : null}
          <div className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {near ? (
              <Link to={near} className="text-accent hover:underline">
                Open {subject.id}
              </Link>
            ) : null}
            {source ? (
              <a href={source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                {subject.source} <ExternalLink size={12} aria-hidden />
              </a>
            ) : subject.source ? (
              <span className="text-muted">{subject.source}</span>
            ) : null}
            {onKeep ? (
              <button type="button" className="tbtn" onClick={onKeep}>
                Keep as an example that {verdict.matched ? "should match" : "should not match"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** One field the condition read: its value, with what decided the answer marked. */
function FieldLine({ why, value, joint }: { why: FieldWhy; value: unknown; joint: boolean }) {
  // Marked by underline as well as tint: colour is never the only cue.
  const decided = "rounded-sm bg-accent/10 px-0.5 text-ink underline decoration-accent underline-offset-2";
  const involved = "text-ink underline decoration-dotted decoration-line-strong underline-offset-2";
  const whole = why.decisive && why.items.length === 0 ? decided : joint ? involved : "text-muted";
  return (
    <>
      <dt className={why.decisive ? "text-ink" : "text-faint"}>{why.field}</dt>
      <dd className="min-w-0 break-words">
        {Array.isArray(value) && value.length > 0 && why.items.length > 0 ? (
          (value as string[]).map((item, at) => (
            <span key={`${item}-${at}`}>
              {at > 0 ? <span className="text-faint"> · </span> : null}
              <span className={why.items.includes(item) ? decided : "text-muted"}>{item}</span>
            </span>
          ))
        ) : (
          <span className={whole}>{shownValue(value)}</span>
        )}
      </dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// The only place that writes.

function Footer({
  results,
  onRemove,
  blocker,
  dirty,
  canWrite,
  busy,
  readingFile,
  onDiscard,
  onSave,
}: {
  results: ExampleResult[];
  onRemove: (name: string) => void;
  blocker: string | null;
  dirty: boolean;
  canWrite: boolean;
  busy: boolean;
  readingFile: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const failing = results.filter((result) => !result.holds);
  // A failing example opens the list on its own: it is why Save is off.
  const [open, setOpen] = useState(false);
  const expanded = open || failing.length > 0;
  const hint = readingFile ? "Reading portolan.json…" : blocker ?? (dirty ? null : "No changes");

  return (
    // Stuck over the pane's own bottom padding, which it then wears, so no
    // row scrolls through the gap under it (the page header does the same at the top).
    <div className="sticky -bottom-gutter z-10 -mb-gutter mt-section max-w-table border-t border-line bg-canvas pt-3 pb-gutter">
      {expanded && results.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {results.map((result) => (
            <li key={result.example.name} className="flex items-baseline gap-2">
              {result.holds ? (
                <Check size={13} aria-hidden className="self-center text-verified" />
              ) : (
                <X size={13} aria-hidden className="self-center text-unresolved" />
              )}
              <span className="mono text-ink">{result.example.name}</span>
              <span className="text-muted">
                should {result.example.expect === "row" ? "match" : "not match"}
                {result.holds ? "" : result.error ? ` · ${result.error}` : " · the rule says otherwise"}
              </span>
              <button type="button" className="tbtn ml-auto border-transparent p-1" aria-label={`Remove example ${result.example.name}`} onClick={() => onRemove(result.example.name)}>
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {results.length === 0 ? (
          <span className="text-muted">No examples yet. Open a row and keep it as one.</span>
        ) : (
          <button type="button" className="flex items-center gap-1.5 text-muted hover:text-ink" aria-expanded={expanded} onClick={() => setOpen((v) => !v)}>
            {failing.length === 0 ? <Check size={14} aria-hidden className="text-verified" /> : <X size={14} aria-hidden className="text-unresolved" />}
            {failing.length === 0
              ? `${results.length} ${plural(results.length, "example")} ${results.length === 1 ? "holds" : "hold"}`
              : `${failing.length} of ${results.length} ${plural(results.length, "example")} ${failing.length === 1 ? "disagrees" : "disagree"}`}
          </button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {hint ? <span className="text-muted">{hint}</span> : null}
          <button type="button" className="tbtn py-1.5" onClick={onDiscard} disabled={busy || !dirty}>
            Discard
          </button>
          <button type="button" className="product-primary" onClick={onSave} disabled={!canWrite || !dirty || blocker !== null}>
            Save rule
          </button>
        </span>
      </div>
    </div>
  );
}
