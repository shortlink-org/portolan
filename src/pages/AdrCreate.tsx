import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Blocks,
  Code2,
  Eye,
  FilePlus2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import type { Adr } from "../catalog";
import { AdrBlockEditor } from "../components/AdrBlockEditor";
import { AdrRelationsEditor } from "../components/AdrRelationsEditor";
import type { AdrRelationsValue } from "../components/AdrRelationsEditor";
import { DatePicker } from "../components/DatePicker";
import { Markdown } from "../components/Markdown";
import { Select } from "../components/Select";
import { activeCatalogProfile, index } from "../data";
import {
  createAdr,
  startGeneration,
  subscribeToRun,
  updateAdr,
} from "../lib/local-api";
import type { CreateAdrInput, CreatedAdr, RunEvent } from "../lib/local-api";
import { adrProjectsQuery, localKeys } from "../lib/queries";
import { paths } from "../routes";
import { NotFound } from "./NotFound";

const STATUS_OPTIONS = [
  { value: "proposed", label: "proposed", note: "Open for discussion and review" },
  { value: "accepted", label: "accepted", note: "The current architectural decision" },
  { value: "superseded", label: "superseded", note: "Replaced by a newer decision" },
  { value: "rejected", label: "rejected", note: "Considered, but deliberately not chosen" },
  { value: "deprecated", label: "deprecated", note: "Kept for history; no longer current" },
] as const;

export const DEFAULT_ADR_BODY = `## Context and Problem Statement

What decision needs to be made, and why now?

## Decision Drivers

- A constraint or goal that matters.

## Considered Options

1. **First option** — its relevant trade-off.
2. **Second option** — its relevant trade-off.

## Decision Outcome

Chosen option: **First option**.

### Consequences

- Good: what becomes easier or safer.
- Bad: what cost or limitation is accepted.
`;

type EditorView = "blocks" | "markdown" | "preview";

interface AdrDraft {
  version: 1;
  projectId: string;
  title: string;
  status: CreateAdrInput["status"];
  date: string;
  body: string;
  note: string;
  supersededBy: string;
  supersedes: string[];
  relates: AdrRelationsValue;
}

interface GenerationProgress {
  message: string;
  completed: number;
  total: number;
}

function localDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function initialDraft(adr?: Adr): AdrDraft {
  return {
    version: 1,
    projectId: "",
    title: adr?.title ?? "",
    status: adr?.status ?? "proposed",
    date: adr?.date ?? localDate(),
    body: adr?.body ?? DEFAULT_ADR_BODY,
    note: adr?.note ?? "",
    supersededBy: adr?.supersededBy ?? "",
    supersedes: adr?.supersedes ?? [],
    relates: {
      services: adr?.relates.services ?? [],
      events: adr?.relates.events ?? [],
      flows: adr?.relates.flows ?? [],
    },
  };
}

function draftKey(adr?: Adr): string {
  return `portolan.adr-draft.v1:${activeCatalogProfile.id}:${adr?.id ?? "new"}`;
}

function readDraft(key: string, fallback: AdrDraft): AdrDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<AdrDraft> | null;
    if (!value || value.version !== 1 || typeof value.title !== "string" || typeof value.body !== "string") return fallback;
    return {
      ...fallback,
      ...value,
      supersedes: Array.isArray(value.supersedes) ? value.supersedes : fallback.supersedes,
      relates: {
        services: Array.isArray(value.relates?.services) ? value.relates.services : fallback.relates.services,
        events: Array.isArray(value.relates?.events) ? value.relates.events : fallback.relates.events,
        flows: Array.isArray(value.relates?.flows) ? value.relates.flows : fallback.relates.flows,
      },
    };
  } catch {
    return fallback;
  }
}

function signature(draft: AdrDraft): string {
  return JSON.stringify(draft);
}

function checks(draft: AdrDraft, ownId: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!draft.title.trim()) errors.push("Give the decision a title.");
  if (!draft.body.trim().startsWith("## ")) errors.push("The body must begin with a level-two Markdown heading.");
  if (draft.status === "superseded" && !draft.supersededBy) errors.push("Choose the ADR that superseded this decision.");
  if (draft.status !== "superseded" && draft.supersededBy) errors.push("Only a superseded ADR can name a successor.");
  if (draft.supersededBy === ownId || draft.supersedes.includes(ownId)) errors.push("An ADR cannot supersede itself.");
  const body = draft.body.toLowerCase();
  if (!body.includes("## context and problem statement")) warnings.push("Add Context and Problem Statement.");
  if (!body.includes("## considered options")) warnings.push("Record the alternatives that were considered.");
  if (!body.includes("## decision outcome")) warnings.push("Add Decision Outcome.");
  if (!body.includes("consequences")) warnings.push("State positive and negative consequences.");
  if (/what decision needs to be made|a constraint or goal that matters|chosen option: \*\*first option/i.test(draft.body)) {
    warnings.push("Replace the remaining template prompts with the actual decision.");
  }
  return { errors, warnings };
}

function runMessage(event: RunEvent, progress: GenerationProgress): GenerationProgress {
  if (event.type === "pipeline-ready") return { message: "Catalog pipeline ready.", completed: 0, total: event.stepCount };
  if (event.type === "step-started") return { ...progress, message: `${event.phase} · ${event.plugin}` };
  if (event.type === "step-finished") return { ...progress, completed: Math.max(progress.completed, event.ordinal), message: `${event.plugin} · ${event.status}` };
  if (event.type === "run-finished") return { ...progress, message: `Generation ${event.status}. Refreshing diagrams…` };
  return progress;
}

function ReferenceList({ label, value, options, disabled, onChange }: {
  label: string;
  value: string[];
  options: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <label>
      <span className="label mb-1 block">{label}</span>
      <input
        className="w-full rounded-control border border-line bg-canvas px-3 py-1.5 mono text-ink outline-none focus:border-accent"
        value={value.join(", ")}
        list="adr-record-ids"
        disabled={disabled}
        placeholder="ADR ids, separated by commas"
        onChange={(event) => onChange(event.target.value.split(",").map((id) => id.trim()).filter(Boolean))}
      />
      <datalist id="adr-record-ids">{options.map((id) => <option key={id} value={id} />)}</datalist>
    </label>
  );
}

export default function AdrCreate() {
  const { adr: slug } = useParams();
  const existing = slug ? index.adrBySlug.get(slug) : undefined;
  const editing = Boolean(slug);
  useDocumentTitle(existing ? `Edit ${existing.title}` : editing ? "Decision not found" : "New decision");
  const queryClient = useQueryClient();
  const state = useQuery(adrProjectsQuery());
  const storageKey = draftKey(existing);
  const base = useMemo(() => initialDraft(existing), [existing]);
  const [draft, setDraft] = useState<AdrDraft>(() => readDraft(storageKey, base));
  const [savedSignature, setSavedSignature] = useState(() => signature(base));
  const [view, setView] = useState<EditorView>("blocks");
  const [editorRevision, setEditorRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>({ message: "", completed: 0, total: 0 });
  const [failure, setFailure] = useState("");
  const [written, setWritten] = useState<CreatedAdr | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const allowLeave = useRef(false);
  const stopRun = useRef<null | (() => void)>(null);

  const projects = activeCatalogProfile.projects.length
    ? (state.data?.projects ?? []).filter((candidate) => activeCatalogProfile.projects.includes(candidate.id))
    : state.data?.projects ?? [];
  const editingProject = existing
    ? projects.find((candidate) => candidate.files.some((file) => file.path === existing.source))
    : undefined;
  const project = editingProject
    ?? projects.find((candidate) => candidate.id === draft.projectId)
    ?? projects.find((candidate) => candidate.writable)
    ?? projects[0];
  const sourceFile = existing && project
    ? project.files.find((file) => file.path === existing.source)
    : undefined;
  const number = existing?.number ?? project?.nextNumber ?? 1;
  const padded = String(number).padStart(4, "0");
  const ownId = existing?.id ?? `${project?.prefix ?? "adr"}.${padded}`;
  const destination = existing?.source
    ?? (project ? `${project.directory}/${padded}-${draft.title ? "…" : "decision"}.md` : "");
  const projectOptions = useMemo(() => projects.map((candidate) => ({
    value: candidate.id,
    label: `${candidate.name} · ${candidate.root}`,
    note: candidate.writable
      ? `${candidate.scope} · ${candidate.count} existing ADR${candidate.count === 1 ? "" : "s"}`
      : candidate.reason,
  })), [projects]);
  const adrOptions = useMemo(
    () => [...index.adrById.keys()].filter((id) => id !== existing?.id).sort(),
    [existing?.id],
  );
  const validation = useMemo(() => checks(draft, ownId), [draft, ownId]);
  const dirty = signature(draft) !== savedSignature;

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...draft, projectId: project?.id ?? draft.projectId }));
        setDraftSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      } catch {
        setDraftSavedAt("unavailable");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, project?.id, storageKey]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || allowLeave.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const followLink = (event: MouseEvent) => {
      if (!dirty || saving || allowLeave.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (window.confirm("Discard the unsaved ADR draft and leave this page?")) {
        allowLeave.current = true;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", followLink, true);
    return () => document.removeEventListener("click", followLink, true);
  }, [dirty, saving]);

  useEffect(() => () => stopRun.current?.(), []);

  function patch(next: Partial<AdrDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setFailure("");
  }

  function clearStoredDraft() {
    try { localStorage.removeItem(storageKey); } catch {}
    setDraftSavedAt("");
  }

  function discardDraft() {
    clearStoredDraft();
    setDraft(base);
    setSavedSignature(signature(base));
    setEditorRevision((revision) => revision + 1);
    setFailure("");
    setWritten(null);
  }

  function finishAt(target: CreatedAdr) {
    allowLeave.current = true;
    const href = `${import.meta.env.BASE_URL}${paths.adr(target.slug).replace(/^\//, "")}?saved=${Date.now()}`;
    window.location.assign(href);
  }

  function watchGeneration(target: CreatedAdr, runId: string) {
    let finished = false;
    setSaving(true);
    setProgress({ message: "Starting catalog rebuild…", completed: 0, total: 0 });
    stopRun.current?.();
    stopRun.current = subscribeToRun(runId, (event) => {
      setProgress((current) => runMessage(event, current));
      if (event.type !== "process-finished") return;
      finished = true;
      stopRun.current?.();
      stopRun.current = null;
      if (event.status === "ok") finishAt(target);
      else {
        setFailure(`The ADR is saved in ${target.path}, but catalog generation ${event.status}.`);
        setProgress({ message: "", completed: 0, total: 0 });
        setSaving(false);
      }
    }, () => {
      if (finished) return;
      setFailure(`The ADR is saved in ${target.path}, but the rebuild connection closed before completion.`);
      setProgress({ message: "", completed: 0, total: 0 });
      setSaving(false);
    });
  }

  async function save() {
    if (!state.data || !project || !project.writable || validation.errors.length) return;
    if (existing && !sourceFile) {
      setFailure("This ADR source is not part of the selected project's configured ADR files.");
      return;
    }
    setSaving(true);
    setFailure("");
    setProgress({ message: editing ? "Updating the decision file…" : "Writing the decision beside its project…", completed: 0, total: 0 });
    try {
      const input: CreateAdrInput = {
        revision: state.data.revision,
        projectId: project.id,
        number,
        title: draft.title.trim(),
        status: draft.status,
        date: draft.date,
        body: draft.body,
        note: draft.note.trim() || undefined,
        supersededBy: draft.supersededBy || undefined,
        supersedes: draft.supersedes,
        relates: draft.relates,
      };
      const result = existing
        ? await updateAdr({ ...input, path: existing.source, fileRevision: sourceFile!.revision })
        : await createAdr(input);
      setWritten(result);
      setSavedSignature(signature(draft));
      clearStoredDraft();
      await queryClient.invalidateQueries({ queryKey: localKeys.adrProjects });
      if (!result.run) {
        setFailure(result.generationError ? `ADR saved, but catalog generation did not start: ${result.generationError}` : "ADR saved, but catalog generation did not start.");
        setProgress({ message: "", completed: 0, total: 0 });
        setSaving(false);
        return;
      }
      watchGeneration(result, result.run.runId);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setProgress({ message: "", completed: 0, total: 0 });
      setSaving(false);
    }
  }

  async function retryRebuild() {
    if (!written) return;
    setFailure("");
    try {
      const run = await startGeneration("write");
      watchGeneration(written, run.runId);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function chooseView(next: EditorView) {
    if (next === "blocks" && view !== "blocks") setEditorRevision((revision) => revision + 1);
    setView(next);
  }

  if (editing && !existing) return <NotFound kind="Decision" id={slug} />;
  if (state.isLoading) return <div className="h-full overflow-y-auto p-gutter text-muted">Reading ADR locations from the dev server…</div>;
  if (state.isError) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="mx-auto max-w-prose rounded-card border border-line bg-canvas p-card shadow-xs">
          <div className="label">local authoring</div>
          <h1 className="mt-1 text-lg font-semibold">Start Portolan in dev mode to write an ADR</h1>
          <p className="mt-2 text-muted">The editor writes into a project repository, so it is deliberately unavailable in a static or deployed catalog.</p>
          <Link to={paths.adrs()} className="tbtn mt-4"><ArrowLeft size={14} /> Back to decisions</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="h-full overflow-y-auto p-gutter"><div className="empty">Connect a project before writing a project decision.</div></div>;

  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line px-gutter py-3">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3">
          <Link to={existing ? paths.adr(existing.slug) : paths.adrs()} className="tbtn h-8 w-8 justify-center p-0" aria-label="Back to decisions"><ArrowLeft size={14} /></Link>
          <div className="min-w-0">
            <div className="label">{editing ? "edit decision" : "new decision"} · {project.name}</div>
            <h1 className="truncate text-md font-semibold">{editing ? existing!.title : "Write an ADR"}</h1>
          </div>
          <span className="chip mono border-line-strong">ADR-{padded}</span>
          {dirty ? <span className="mono text-declared">draft{draftSavedAt ? ` saved ${draftSavedAt}` : "…"}</span> : null}
          {dirty ? <button type="button" className="tbtn ml-auto" disabled={saving} onClick={discardDraft}><RotateCcw size={14} /> Discard draft</button> : <span className="ml-auto" />}
          <button type="button" className="product-primary" disabled={saving || !project.writable || validation.errors.length > 0 || (!dirty && editing)} onClick={() => void save()}>
            {saving ? <LoaderCircle size={15} className="animate-spin" /> : editing ? <Save size={15} /> : <FilePlus2 size={15} />}
            {saving ? "Saving…" : editing ? "Update & rebuild" : "Save & rebuild"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[1180px] p-gutter">
        <section className="min-w-0 overflow-hidden rounded-card border border-line bg-canvas shadow-xs">
          <div className="border-b border-line bg-surface px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(15rem,1.5fr)_9rem_11rem]">
              <label>
                <span className="label mb-1 block">project</span>
                <Select value={project.id} options={projectOptions} onChange={(projectId) => patch({ projectId })} label="Project" className="w-full" menuWidth={360} disabled={saving || editing} appearance="detail" />
              </label>
              <label>
                <span className="label mb-1 block">status</span>
                <Select value={draft.status} options={STATUS_OPTIONS} onChange={(status) => patch({ status: status as CreateAdrInput["status"], ...(status !== "superseded" ? { supersededBy: "" } : {}) })} label="ADR status" className="w-full" menuWidth={320} disabled={saving} appearance="detail" />
              </label>
              <label>
                <span className="label mb-1 block">decision date</span>
                <DatePicker value={draft.date} onChange={(date) => patch({ date })} label="Decision date" disabled={saving} />
              </label>
            </div>
            <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-faint">
              <span>scope · <span className="text-muted">{project.scope}</span></span>
              <span className="min-w-0 truncate">source · <span className="text-muted">{destination}</span></span>
              <span>{project.count} existing</span>
              {!project.configured ? <span className="text-declared">extractor will be added</span> : null}
            </div>
            {!project.writable ? <p className="status-unresolved mt-2 rounded-control px-3 py-2">{project.reason}</p> : null}
            {editing && !sourceFile ? <p className="status-unresolved mt-2 rounded-control px-3 py-2">This catalog record cannot be matched to a writable source file in this project.</p> : null}
          </div>

          <div className="border-b border-line px-4 py-3">
            <label>
              <span className="label mb-1 block">decision title</span>
              <input className="w-full bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-faint" value={draft.title} onChange={(event) => patch({ title: event.target.value })} maxLength={180} placeholder="The decision in one sentence" autoFocus={!editing} disabled={saving} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            <button type="button" className={`tbtn h-7 px-2 ${view === "blocks" ? "tbtn-on" : ""}`} onClick={() => chooseView("blocks")}><Blocks size={13} /> Blocks</button>
            <button type="button" className={`tbtn h-7 px-2 ${view === "markdown" ? "tbtn-on" : ""}`} onClick={() => chooseView("markdown")}><Code2 size={13} /> Markdown</button>
            <button type="button" className={`tbtn h-7 px-2 ${view === "preview" ? "tbtn-on" : ""}`} onClick={() => chooseView("preview")}><Eye size={13} /> Preview</button>
            <span className="ml-auto text-faint">Markdown is the stored source of truth.</span>
          </div>
          {view === "blocks" ? (
            <AdrBlockEditor key={`${storageKey}:${editorRevision}`} disabled={saving} initialMarkdown={draft.body} onChange={(body) => patch({ body })} />
          ) : view === "markdown" ? (
            <textarea className="mono min-h-[30rem] w-full resize-y bg-canvas px-6 py-5 text-ink outline-none" spellCheck={false} value={draft.body} disabled={saving} onChange={(event) => patch({ body: event.target.value })} />
          ) : (
            <div className="min-h-[30rem] px-6 py-5"><Markdown mermaid>{draft.body}</Markdown></div>
          )}

          <AdrRelationsEditor value={draft.relates} disabled={saving} onChange={(relates) => patch({ relates })} />

          <section className="grid gap-3 border-t border-line px-4 py-4 md:grid-cols-2">
            <label>
              <span className="label mb-1 block">note</span>
              <input className="w-full rounded-control border border-line bg-canvas px-3 py-1.5 text-ink outline-none focus:border-accent" value={draft.note} maxLength={500} disabled={saving} placeholder="Optional context not captured by another field" onChange={(event) => patch({ note: event.target.value })} />
            </label>
            <ReferenceList label="supersedes" value={draft.supersedes} options={adrOptions} disabled={saving} onChange={(supersedes) => patch({ supersedes })} />
            {draft.status === "superseded" ? (
              <label>
                <span className="label mb-1 block">superseded by</span>
                <Select value={draft.supersededBy} options={[{ value: "", label: "Choose a successor" }, ...adrOptions.map((id) => ({ value: id, label: id }))]} onChange={(supersededBy) => patch({ supersededBy })} label="Superseded by" className="w-full" menuWidth={320} disabled={saving} appearance="detail" />
              </label>
            ) : null}
          </section>

          {(validation.errors.length || validation.warnings.length) ? (
            <section className="border-t border-line px-4 py-3">
              <div className="label">quality before save</div>
              <div className="mt-2 grid gap-1">
                {validation.errors.map((message) => <p key={message} className="text-unresolved">Error · {message}</p>)}
                {validation.warnings.map((message) => <p key={message} className="text-declared">Warning · {message}</p>)}
              </div>
            </section>
          ) : null}

          {failure || progress.message ? (
            <div className="border-t border-line px-card py-3">
              {failure ? <p className="text-unresolved">{failure}</p> : null}
              {progress.message ? <p className="text-muted">{progress.message}</p> : null}
              {progress.total ? (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
                  <div className="mono mt-1 text-faint">{progress.completed} / {progress.total} steps</div>
                </div>
              ) : null}
              {failure && written ? <button type="button" className="tbtn mt-3" disabled={saving} onClick={() => void retryRebuild()}><RefreshCw size={14} /> Retry rebuild</button> : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
