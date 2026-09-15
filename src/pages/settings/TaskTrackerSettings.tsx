import { useEffect, useState } from "react";
import { Field, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { Check, ChevronDown, Copy, ExternalLink, GitCommitHorizontal, Plus, Save, ScanSearch, Ticket, Trash2, X } from "lucide-react";
import { activeCatalogProfile } from "../../data";
import { setupInfo } from "../../lib/setup-info";
import { toClipboard } from "../../lib/clipboard";
import { useToastStore } from "../../app/toast";
import { taskTrackerSettings, saveTaskTrackers, fullScanTaskTrackers, subscribeToRun, cancelGeneration } from "../../lib/local-api";
import type { SaveTaskTrackers, TaskTrackerState } from "../../lib/local-api";
import { DEFAULT_KEY_FORMAT, DEFAULT_ISSUE_URL, TRACKER_PROVIDERS, detectTaskKeys, normalizeTrackers, taskUrl } from "../../lib/task-tracker-config.mjs";
import type { TaskTracker } from "../../lib/task-tracker-config.mjs";
import { TaskTrackerIcon } from "../../components/TaskTrackerIcon";
import { WorkItemGitRequirement } from "./WorkItemGitRequirement";

const FIELD = "mono w-full min-w-0 rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent";
const blankTracker = (): TaskTracker => ({ id: "", name: "", provider: "youtrack", baseUrl: "", projects: [], keyFormat: DEFAULT_KEY_FORMAT, urlTemplate: DEFAULT_ISSUE_URL });
type Draft = Omit<SaveTaskTrackers, "revision" | "generate" | "fullScan">;

export function CatalogScope({ catalogs, value, disabled, onChange }: { catalogs: TaskTrackerState["catalogs"]; value: string[]; disabled: boolean; onChange: (value: string[]) => void }) {
  const selected = catalogs.filter((catalog) => value.includes(catalog.id));
  return <Field className="min-w-0">
    <Label className="label mb-1.5 block">Catalog scope</Label>
    <Listbox multiple value={value} onChange={onChange} disabled={disabled}>
      <ListboxButton className={`${FIELD} flex items-center gap-2 text-left disabled:opacity-60`}>
        <span className="min-w-0 flex-1 truncate">{selected.length ? selected.map((catalog) => catalog.title).join(", ") : "Select catalogs"}</span>
        {selected.length > 1 ? <span className="chip shrink-0 text-muted">{selected.length}</span> : null}
        <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
      </ListboxButton>
      <ListboxOptions anchor="bottom start" className="z-50 max-h-60 w-[var(--button-width)] overflow-auto rounded-control border border-line bg-canvas p-1 shadow-lg [--anchor-gap:4px] focus:outline-none">
        {catalogs.map((catalog) => <ListboxOption key={catalog.id} value={catalog.id} className="group flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-ink data-focus:bg-surface">
          <Check size={14} className="shrink-0 text-accent opacity-0 group-data-selected:opacity-100" aria-hidden />
          <span className="min-w-0 break-words">{catalog.title}</span>
        </ListboxOption>)}
      </ListboxOptions>
    </Listbox>
  </Field>;
}
const SCAN_HINT = "Reads task links from all locally available commits reachable from HEAD until the dev server restarts. Does not fetch missing history or change the saved history limit.";

function TrackerFields({ tracker, onChange, onRemove, number }: { tracker: TaskTracker; onChange: (value: TaskTracker) => void; onRemove: () => void; number: number }) {
  const [sample, setSample] = useState(TRACKER_PROVIDERS[tracker.provider].numbered ? "Fixes #123: added toolbar" : "RT-101: added toolbar");
  const provider = TRACKER_PROVIDERS[tracker.provider];
  const change = (patch: Partial<TaskTracker>) => onChange({ ...tracker, ...patch });
  const selectProvider = (value: TaskTracker["provider"]) => {
    const next = TRACKER_PROVIDERS[value];
    change({ provider: value, baseUrl: "", projects: [], keyFormat: next.keyFormat, urlTemplate: next.urlTemplate, matchBareNumbers: next.numbered ? true : undefined });
    setSample(next.numbered ? "Fixes #123: added toolbar" : "RT-101: added toolbar");
  };
  let error = "";
  let links: Array<{ key: string; url: string }> = [];
  try {
    normalizeTrackers([tracker]);
    links = detectTaskKeys(sample, tracker).map((key) => ({ key, url: taskUrl(tracker, key) }));
  } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }

  return (
    <fieldset className="min-w-0 rounded-control border border-line bg-surface p-4">
      <legend className="px-1 font-medium"><span className="inline-flex items-center gap-2"><TaskTrackerIcon provider={tracker.provider} />{provider.label} · {number}</span></legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field className="min-w-0 sm:col-span-2">
          <Label className="label mb-1.5 block">Provider</Label>
          <Listbox value={tracker.provider} onChange={selectProvider}>
            <ListboxButton className={`${FIELD} flex items-center gap-2 text-left disabled:opacity-60`}><TaskTrackerIcon provider={tracker.provider} size={20} /><span className="flex-1">{provider.label}</span><ChevronDown size={14} className="text-muted" aria-hidden /></ListboxButton>
            <ListboxOptions anchor="bottom start" className="z-50 max-h-72 w-[var(--button-width)] overflow-auto rounded-control border border-line bg-canvas p-1 shadow-lg [--anchor-gap:4px] focus:outline-none">
              {Object.entries(TRACKER_PROVIDERS).map(([id, definition]) => <ListboxOption key={id} value={id} className="group flex cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-ink data-focus:bg-surface"><TaskTrackerIcon provider={id} size={20} /><span className="flex-1">{definition.label}</span><Check size={14} className="text-accent opacity-0 group-data-selected:opacity-100" aria-hidden /></ListboxOption>)}
            </ListboxOptions>
          </Listbox>
          <p className="mt-1 text-xs text-muted">Changing provider resets its address and detection rules.</p>
        </Field>
        <label className="min-w-0"><span className="label mb-1.5 block">Name</span><input className={FIELD} value={tracker.name ?? ""} placeholder={`Team ${provider.label}`} maxLength={100} onChange={(e) => change({ name: e.target.value })} /></label>
        <label className="min-w-0"><span className="label mb-1.5 block">Tracker ID</span><input className={FIELD} value={tracker.id} placeholder="team" maxLength={60} spellCheck={false} onChange={(e) => change({ id: e.target.value })} /><span className="mt-1 block text-xs text-muted">Stable identity across repositories.</span></label>
        <label className="min-w-0 sm:col-span-2"><span className="label mb-1.5 block">{provider.addressLabel}</span><input type="url" className={FIELD} value={tracker.baseUrl} placeholder={provider.placeholder} spellCheck={false} onChange={(e) => change({ baseUrl: e.target.value })} /></label>
        {provider.numbered ? <label className="flex items-start gap-2 sm:col-span-2"><input type="checkbox" className="mt-1 accent-accent" checked={tracker.matchBareNumbers !== false} onChange={(e) => change({ matchBareNumbers: e.target.checked })} /><span>Match short #123 references<span className="mt-1 block text-xs text-muted">Enable for only one tracker per checkout. Qualified references such as owner/repo#123 always match the configured project. GitLab !123 merge requests are excluded.</span></span></label> : <label className="min-w-0"><span className="label mb-1.5 block">Project prefixes</span><input className={FIELD} value={tracker.projects.join(",")} placeholder="RT,CORE" spellCheck={false} onChange={(e) => change({ projects: e.target.value.split(",").map((value) => value.trim()) })} /><span className="mt-1 block text-xs text-muted">Comma-separated, case-sensitive.</span></label>}
        {!provider.numbered ? <label className="min-w-0"><span className="label mb-1.5 block">Key format</span><input className={FIELD} value={tracker.keyFormat ?? provider.keyFormat} spellCheck={false} onChange={(e) => change({ keyFormat: e.target.value })} /></label> : null}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-muted">Link format & detection rules</summary>
        <label className="mt-3 block"><span className="label mb-1.5 block">Task URL template</span><input className={FIELD} value={tracker.urlTemplate ?? provider.urlTemplate} spellCheck={false} onChange={(e) => change({ urlTemplate: e.target.value })} /></label>
        <p className="mt-2 text-xs text-muted">{provider.numbered ? "Keys use # and a positive issue number. Use {number} in the URL to omit the #. Qualified references use the project path from the address above." : "Keys use a project prefix, a literal separator (- _ : # / .), and a number."} Commit subjects and bodies are scanned. The link stays on the tracker host. Templates are not regular expressions.</p>
      </details>
      <div className="mt-4 border-t border-line pt-3">
        <label className="block"><span className="label mb-1.5 block">Test a commit message</span><textarea rows={2} maxLength={4000} className={`${FIELD} resize-y`} value={sample} onChange={(e) => setSample(e.target.value)} /></label>
        <div aria-live="polite" className="mt-2 break-words text-sm">
          {error ? <p className="text-unresolved">{error}</p> : links.length ? <div className="space-y-1">{links.map((link) => <a key={link.key} className="flex min-w-0 items-start gap-2 text-accent hover:underline" href={link.url} target="_blank" rel="noreferrer"><span className="shrink-0 font-medium">{link.key}</span><span className="min-w-0 break-all text-muted">{link.url}</span><ExternalLink size={13} className="mt-1 shrink-0" aria-hidden /></a>)}</div> : <p className="text-muted">No task keys match this message.</p>}
        </div>
        <p className="mt-2 text-xs text-faint">Local detection preview only. No request is sent to the tracker; task existence and access are not checked.{tracker.provider === "github" ? " GitHub shares issue and pull request numbers; distinguishing them requires API access." : ""}</p>
      </div>
      <button type="button" className="tbtn mt-3 px-2 py-1 text-unresolved" onClick={onRemove}><Trash2 size={13} aria-hidden />Remove tracker</button>
    </fieldset>
  );
}

export function TaskTrackerSettings({ local }: { local: boolean }) {
  const say = useToastStore((state) => state.say);
  const [state, setState] = useState<TaskTrackerState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState("");
  const [runDone, setRunDone] = useState(false);

  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    taskTrackerSettings().then((value) => { if (!cancelled) setState(value); }).catch((cause: unknown) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [local]);

  useEffect(() => {
    if (!runId) return;
    let finished = false;
    let historyWarning = "";
    const close = subscribeToRun(runId, (event) => {
      if (event.type === "step-finished") historyWarning ||= event.warnings?.find((warning) => /work item history is incomplete/.test(warning)) ?? "";
      if (event.type !== "process-finished") return;
      finished = true;
      setRunMessage(event.status === "ok" ? `Catalog and diagrams rebuilt. Reload to view the new task links.${historyWarning ? ` Warning: ${historyWarning}` : ""}` : `Generation ${event.status}. See Build settings for details and retry.`);
      setRunDone(event.status === "ok");
      setRunId(null);
    }, () => {
      if (!finished) { setRunMessage("Settings saved. The build connection was interrupted; check Build settings before retrying."); setRunId(null); }
    });
    return close;
  }, [runId]);

  const reloadSettings = async () => {
    setBusy(true);
    try { setState(await taskTrackerSettings()); setDraft(null); setError(""); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const entries = state?.entries ?? (setupInfo.taskTrackers ?? []).map((entry) => ({ ...entry, managed: false, catalogs: [] }));
  const existing = draft?.step === null ? null : entries.find((entry) => entry.step === draft?.step);
  let validation = "";
  if (draft) {
    try {
      normalizeTrackers(draft.trackers);
      if (!Number.isInteger(draft.maxCommits) || draft.maxCommits < 1 || draft.maxCommits > 10000) throw new Error("History limit must be between 1 and 10000.");
      if (!draft.input) throw new Error("Select a Git repository.");
      if (state?.catalogs.length && !draft.catalogs.length) throw new Error("Select at least one catalog.");
    } catch (cause) { validation = cause instanceof Error ? cause.message : String(cause); }
  }
  const add = () => {
    setError("");
    setDraft({ step: null, input: state?.repositories.find((repository) => repository.available && !entries.some((entry) => entry.input === repository.input))?.input ?? "", catalogs: state?.catalogs.some((catalog) => catalog.id === activeCatalogProfile.id) ? [activeCatalogProfile.id] : state?.catalogs.map((catalog) => catalog.id) ?? [], trackers: [blankTracker()], maxCommits: 500 });
  };
  const scan = async (step: number) => {
    if (!state || busy || runId) return;
    setBusy(true); setError(""); setRunDone(false);
    try {
      await fullScanTaskTrackers(state.revision, step);
      setRunDone(true);
      setRunMessage("Task links are read again from the whole local history; the pages reload with them. The saved commit limit is unchanged, and shallow checkouts still have incomplete history.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const save = async (generate: boolean, fullScan = false) => {
    if (!draft || !state || validation) return;
    setBusy(true); setError(""); setRunDone(false);
    try {
      const saved = await saveTaskTrackers({ ...draft, trackers: normalizeTrackers(draft.trackers), revision: state.revision, generate, fullScan });
      setState(saved); setDraft(null);
      setRunMessage(saved.generationError ? `Settings saved; generation could not start: ${saved.generationError}` : saved.run ? fullScan ? "Settings saved. Rebuilding catalog and diagrams; task links are read from the whole local history." : "Settings saved. Rebuilding catalog and diagrams…" : "Settings saved to portolan.json. Task links follow on the next reload.");
      setRunId(saved.run?.runId ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    const config = draft ? [{ plugin: "work-items", in: draft.input || ".", out: existing?.output ?? "portolan-work-items/repository", options: { trackers: normalizeTrackers(draft.trackers), maxCommits: draft.maxCommits, out: existing?.file ?? "work-items.json" } }] : entries.map((entry) => ({ plugin: "work-items", in: entry.input, out: entry.output, options: { trackers: entry.trackers, maxCommits: entry.maxCommits, out: entry.file } }));
    const sources = config.map((step) => `${step.out}/${step.options.out}`);
    say(await toClipboard(JSON.stringify({ plugins: [{ name: "work-items", host: "work-items" }], verify: config, sources }, null, 2)) ? "Configuration snippet copied. Merge into portolan.json and add the sources to the intended catalog profiles." : "Could not copy configuration.");
  };

  return (
    <section className="min-w-0 rounded-card border border-line bg-canvas p-card shadow-xs lg:col-span-2">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface"><Ticket size={18} aria-hidden /></span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Task trackers</h2><span className="chip text-muted">{local ? "project configuration" : "read-only catalog"}</span></div><p className="mt-1 text-muted">Connect commits to YouTrack, Jira, Linear, GitHub or GitLab issues. Address, detection rules and repository scope live in portolan.json, not browser storage.</p></div>
      </div>
      <WorkItemGitRequirement repositories={state?.repositories} local={local} catalog={activeCatalogProfile.id} refreshing={busy} onRefresh={!draft && !runId ? () => void reloadSettings() : undefined} />
      <div className="mt-4 space-y-2">
        {entries.map((entry) => <div key={entry.step} className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface px-3 py-2"><GitCommitHorizontal size={15} className="shrink-0 text-muted" aria-hidden /><div className="min-w-0 flex-1"><div className="break-all font-medium">{entry.input}</div><div className="mt-1.5 flex flex-wrap gap-2">{entry.trackers.length ? entry.trackers.map((tracker) => <span key={tracker.id} className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-line bg-canvas px-2 py-1 text-xs text-muted" title={`${TRACKER_PROVIDERS[tracker.provider].label} · ${tracker.baseUrl}`}><TaskTrackerIcon provider={tracker.provider} size={15} /><span className="truncate">{tracker.name || tracker.id}{tracker.projects.length ? ` · ${tracker.projects.join(", ")}` : ""}</span></span>) : <span className="text-xs text-muted">Disabled · no task links are read</span>}</div></div><span className="chip text-muted">{entry.maxCommits} commits</span>{local ? <button type="button" title={SCAN_HINT} disabled={busy || !!runId || !!draft || !state || !entry.trackers.length} className="tbtn px-2 py-1" onClick={() => void scan(entry.step)}><ScanSearch size={14} aria-hidden />Full scan</button> : null}<button type="button" disabled={busy || !!runId || !!draft} className="tbtn px-2 py-1" onClick={() => { setDraft({ step: entry.step, input: entry.input, catalogs: entry.catalogs, trackers: structuredClone(entry.trackers), maxCommits: entry.maxCommits }); setError(""); }}>{local ? "Configure" : "View configuration"}</button></div>)}
        {!entries.length && !draft ? <p className="rounded-control border border-dashed border-line p-4 text-muted">{local && !state && !error ? "Loading tracker configuration…" : "No task tracker configured. Choose a provider and the address used for task links. No API token is needed."}</p> : null}
      </div>
      {draft ? <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between"><h3 className="font-medium">{draft.step === null ? "Connect repository" : "Repository configuration"}</h3><button type="button" className="tbtn p-1" aria-label="Close tracker configuration" disabled={busy} onClick={() => setDraft(null)}><X size={16} /></button></div>
        <fieldset disabled={busy || !local} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <label className="min-w-0"><span className="label mb-1.5 block">Git repository</span>{draft.step !== null ? <div className={`${FIELD} break-all`}>{draft.input}</div> : <select className={FIELD} value={draft.input} onChange={(e) => setDraft({ ...draft, input: e.target.value })}><option value="">Choose repository</option>{state?.repositories.map((repository) => <option key={repository.input} value={repository.input} disabled={!repository.available || entries.some((entry) => entry.input === repository.input)}>{repository.label} · {repository.input}{!repository.available ? " (unavailable)" : ""}</option>)}</select>}<span className="mt-1 block text-xs text-muted">Only checkout roots with local commits are selectable. See Git history above for availability and reasons.</span></label>
            <label><span className="label mb-1.5 block">History limit</span><input type="number" min={1} max={10000} className={FIELD} value={draft.maxCommits} onChange={(e) => setDraft({ ...draft, maxCommits: Number(e.target.value) })} /></label>
          </div>
          {state?.catalogs.length ? <div><CatalogScope catalogs={state.catalogs} value={draft.catalogs} disabled={busy || !local || (!!existing && !existing.managed)} onChange={(catalogs) => setDraft({ ...draft, catalogs })} />{existing && !existing.managed ? <p className="mt-2 text-xs text-muted">Source scope is managed manually in portolan.json for this verifier.</p> : null}</div> : null}
          {draft.trackers.map((tracker, index) => <TrackerFields key={index} number={index + 1} tracker={tracker} onChange={(value) => setDraft({ ...draft, trackers: draft.trackers.map((item, i) => i === index ? value : item) })} onRemove={() => setDraft({ ...draft, trackers: draft.trackers.filter((_, i) => i !== index) })} />)}
          {!draft.trackers.length ? <p className="text-muted">No trackers: this verifier reads no task links.</p> : null}
          {local ? <button type="button" className="tbtn px-3 py-1.5" onClick={() => setDraft({ ...draft, trackers: [...draft.trackers, blankTracker()] })}><Plus size={14} />Add tracker</button> : null}
        </fieldset>
        {validation && local ? <p role="status" className="text-sm text-unresolved">{validation}</p> : null}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {local ? <><button type="button" className="product-primary" disabled={!!validation || busy || !state} onClick={() => void save(true)}><Save size={14} />{busy ? "Saving…" : "Save & rebuild"}</button><button type="button" className="tbtn px-3 py-1.5" disabled={!!validation || busy || !state} onClick={() => void save(false)}>Save configuration only</button></> : null}
          {local ? <button type="button" title={SCAN_HINT} className="tbtn px-3 py-1.5" disabled={!!validation || busy || !state || !draft.trackers.length} onClick={() => void save(true, true)}><ScanSearch size={14} aria-hidden />Save & full scan</button> : null}
          <button type="button" className="tbtn px-3 py-1.5" disabled={!!validation || busy} onClick={() => void copy()}><Copy size={14} />Copy config snippet</button>
        </div>
        {local ? <p className="text-xs text-muted">Full scan reads task links without the history limit until the dev server restarts. It reads local HEAD history without fetching missing commits; builds use the saved limit.</p> : null}
      </div> : <div className="mt-4 flex flex-wrap gap-2">{local ? <button type="button" className="tbtn px-3 py-1.5" disabled={!state || busy || !!runId} onClick={add}><Plus size={14} />Connect repository</button> : <p className="text-xs text-muted">Open this project with <code>portolan dev</code> to change tracker configuration.</p>}{entries.length ? <button type="button" className="tbtn px-3 py-1.5" onClick={() => void copy()}><Copy size={14} />Copy config snippet</button> : null}</div>}
      {error ? <div role="alert" className="mt-3 text-unresolved"><p className="break-words">{error}</p>{local ? <button type="button" className="tbtn mt-2 px-2 py-1" disabled={busy} onClick={() => void reloadSettings()}>Reload settings (discard draft)</button> : null}</div> : null}
      {runMessage ? <div role="status" className="mt-3 text-muted">{runMessage}{runDone ? <button type="button" className="tbtn ml-2 px-2 py-1" onClick={() => window.location.reload()}>Reload catalog</button> : null}</div> : null}
      {runId ? <button type="button" className="tbtn mt-2 px-2 py-1" onClick={() => void cancelGeneration(runId).catch((cause: unknown) => setError(String(cause)))}>Cancel run</button> : null}
      <p className="mt-4 border-t border-line pt-3 text-xs text-faint">Git supplies task keys and commit evidence. Titles, statuses and assignees require a future API connection; none are fetched here.</p>
    </section>
  );
}
