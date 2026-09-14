import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Download, FolderGit2, Save, Trash2, X } from "lucide-react";
import { Select } from "../../components/Select";
import { SettingsChevron, SettingsReveal } from "./SettingsReveal";
import { activeCatalogProfile } from "../../data";
import { cancelGeneration, gitFetchSettings, saveGitFetch, subscribeToRun } from "../../lib/local-api";
import type { GitFetchState, SaveGitFetch } from "../../lib/local-api";
import { gitRepoDirectory, gitSourcePath, normalizeGitRepos, gitRepositoryAddress } from "../../lib/git-fetch-config.mjs";
import { projectGitOutput, projectGitSettings, updateGitDraftRepos } from "../../lib/git-project-settings";
import type { GitFetchRepo } from "../../lib/git-fetch-config.mjs";
import { paths } from "../../routes";
import { ProjectRepositories } from "./ProjectRepositories";
import { GitRefPicker } from "./GitRefPicker";

const FIELD = "mono w-full min-w-0 rounded-control border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent disabled:opacity-60";
type Draft = Omit<SaveGitFetch, "revision" | "generate">;
const blank = (): GitFetchRepo => ({ repo: "", ref: "main" });

function RepositoryFields({ repo, onChange, onRemove, output, disabled }: { repo: GitFetchRepo; onChange: (repo: GitFetchRepo) => void; onRemove?: () => void; output: string; disabled: boolean }) {
  const pinned = repo.commit !== undefined;
  let directory = "owner/repository";
  try { directory = gitRepoDirectory(normalizeGitRepos([repo])[0]!.repo); } catch { /* Incomplete draft. */ }
  return <fieldset className="min-w-0 rounded-control border border-line bg-surface p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 sm:col-span-2"><span className="label mb-1.5 block">Repository address</span><input className={FIELD} value={repo.repo} placeholder="github.com/owner/repository" spellCheck={false} onChange={(e) => onChange({ ...repo, repo: e.target.value })} /><span className="mt-1 block text-xs text-muted">HTTPS or SSH. Authentication uses Git’s credential helper or SSH agent; never paste a token here.</span></label>
      <div className="min-w-0"><span className="label mb-1.5 block">Revision mode</span><Select label="Revision mode" appearance="detail" className="w-full min-w-0 py-2" disabled={disabled} value={pinned ? "commit" : "ref"} onChange={(value) => onChange({ repo: repo.repo, ...(value === "commit" ? { commit: "" } : { ref: "main" }) })} options={[{ value: "ref", label: "Branch / tag", note: "Resolve a branch or tag when fetching" }, { value: "commit", label: "Pinned commit", note: "Use an exact 40-character commit SHA" }]} /></div>
      {pinned ? <label className="min-w-0"><span className="label mb-1.5 block">Commit SHA</span><input className={FIELD} value={repo.commit} placeholder="Full 40-character SHA" spellCheck={false} onChange={(e) => onChange({ ...repo, commit: e.target.value })} /></label> : <GitRefPicker repository={repo.repo} value={repo.ref ?? ""} disabled={disabled} onChange={(ref) => onChange({ ...repo, ref })} />}
    </div>
    <p className="mt-3 break-all text-xs text-muted">Snapshot: <code>{output}/{directory}</code></p>
    {onRemove ? <button type="button" className="tbtn mt-3 px-2 py-1 text-unresolved" onClick={onRemove}><Trash2 size={13} aria-hidden />Remove repository</button> : null}
  </fieldset>;
}

export function GitFetchSettings({ local }: { local: boolean }) {
  const [state, setState] = useState<GitFetchState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorTarget, setEditorTarget] = useState<string | null>(null);
  const [editorExpanded, setEditorExpanded] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const editing = draft !== null && editorExpanded;
  useEffect(() => { if (editing) editorHeading.current?.focus(); }, [editing]);
  const catalog = state?.catalogs.length ? activeCatalogProfile.id : null;
  const projectTitle = state?.catalogs.find((item) => item.id === catalog)?.title ?? activeCatalogProfile.title;
  const { entries, repositories, available, connected } = state ? projectGitSettings(state, catalog) : { entries: [], repositories: [], available: [], connected: new Set<string>() };
  const sharedDraft = draft?.step != null && state?.entries.find((entry) => entry.step === draft.step)?.catalogs.some((id) => id !== catalog);
  const openDraft = (url?: string) => {
    setError(""); setMessage("");
    setEditorTarget(url ? gitRepositoryAddress(url).identity : null);
    setEditorExpanded(true);
    if (!state) return;
    setDraft({ step: null, output: projectGitOutput(state, catalog, url), repos: [url ? { repo: url } : blank()], catalog });
  };
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    gitFetchSettings().then((value) => { if (!cancelled) setState(value); }).catch((cause: unknown) => { if (!cancelled) setError(String(cause)); });
    return () => { cancelled = true; };
  }, [local]);
  useEffect(() => {
    if (!runId) return;
    let finished = false;
    const warnings = new Set<string>();
    return subscribeToRun(runId, (event) => {
      if (event.type === "step-finished") for (const warning of event.warnings ?? []) warnings.add(warning);
      if (event.type !== "process-finished") return;
      finished = true; setRunId(null); setDone(event.status === "ok");
      setMessage(event.status === "ok" ? `Pipeline completed. ${warnings.size ? `Warnings: ${[...warnings].slice(0, 3).join("; ")}` : "Reload the catalog to see updated snapshots."}` : `Pipeline ${event.status}. Settings remain saved; inspect Pipeline settings and retry.`);
    }, () => { if (!finished) { setRunId(null); setMessage("Build connection interrupted. Check Pipeline settings before retrying."); } });
  }, [runId]);
  let validation = "";
  if (draft) try {
    normalizeGitRepos(draft.repos); gitSourcePath(draft.output);
    if (draft.step === null && !draft.output.startsWith("vendor/repos/")) throw new Error("Choose a dedicated directory under vendor/repos/.");
    if (state?.catalogs.length && !state.catalogs.some((item) => item.id === draft.catalog)) throw new Error("Open a known project before configuring its repositories.");
  } catch (cause) { validation = cause instanceof Error ? cause.message : String(cause); }
  const save = async (generate: boolean, value = draft) => {
    if (!value || !state || busy || runId) return;
    setBusy(true); setError(""); setDone(false);
    try {
      const saved = await saveGitFetch({ ...value, repos: normalizeGitRepos(value.repos), revision: state.revision, generate });
      setState(saved); setDraft(null); setRunId(saved.run?.runId ?? null);
      setMessage(saved.generationError ? `Settings saved, but generation could not start: ${saved.generationError}` : saved.run ? "Settings saved. Fetch and rebuild started; this runs the full project pipeline." : "Settings saved to portolan.json. Fetch and rebuild to update snapshots.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    setBusy(true);
    try { setState(await gitFetchSettings()); setDraft(null); setError(""); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const errorNotice = error ? <div role="alert" className="mt-3 text-unresolved"><p className="break-words">{error}</p><button type="button" className="tbtn mt-2 px-2 py-1" disabled={busy || !!runId} onClick={() => void reload()}>Reload settings (discard draft)</button></div> : null;
  const draftEditor = draft ? <div className="space-y-4">
        <div className="flex items-center justify-between"><h3 ref={editorHeading} tabIndex={-1} className="font-medium outline-none">{draft.step === null ? "New fetch step" : "Configure fetch step"}</h3><button type="button" aria-label="Close Git configuration" className="tbtn p-1" disabled={busy} onClick={() => setDraft(null)}><X size={16} /></button></div>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <p className="text-sm text-muted">Connection for <span className="font-medium text-ink">{projectTitle}</span>. The selected revision applies to this project only.</p>
          {sharedDraft ? <p role="status" className="text-sm text-muted">Saving creates a separate connection for this project. Other projects keep the existing snapshot and settings. Update this project's downstream extractors to use the new output.</p> : null}
          {draft.repos.map((repo, index) => <RepositoryFields key={index} disabled={busy} repo={repo} output={draft.output} onChange={(value) => setDraft(updateGitDraftRepos(state!, draft, draft.repos.map((item, i) => i === index ? value : item)))} onRemove={draft.repos.length > 1 ? () => setDraft(updateGitDraftRepos(state!, draft, draft.repos.filter((_, i) => i !== index))) : undefined} />)}
          <p className="text-xs text-muted">Cache paths are assigned automatically from the project and repository name. Existing connections keep their paths.</p>
        </fieldset>
        {errorNotice}
        {validation ? <p role="status" className="text-sm text-unresolved">{validation}</p> : null}
        <p className="text-xs text-muted">Saving adds repository metadata to this project. Configure downstream extractors separately to turn source files into flows and services. Removing repositories can remove their generated snapshot files on the next rebuild.</p>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4"><button type="button" className="product-primary" disabled={!!validation || busy} onClick={() => void save(false)}><Save size={14} />Save configuration</button><button type="button" className="tbtn px-3 py-1.5" disabled={!!validation || busy} onClick={() => void save(true)}><Download size={14} />Save, fetch & rebuild</button></div>
      </div> : null;
  return <section className="min-w-0 rounded-card border border-line bg-canvas p-card shadow-xs">
    <div className="flex items-start gap-3"><FolderGit2 size={22} className="mt-1 shrink-0" aria-hidden /><div><h2 className="font-semibold">Git source snapshots</h2><p className="mt-1 text-muted">Fetch pinned source files from other repositories. Each snapshot includes a lock and repository metadata, but no persistent .git history.</p></div></div>
    <div className="mt-4 rounded-control border border-line bg-surface p-3 text-sm text-muted">Pinned commits are reproducible. Branches and tags are resolved online and cannot be refreshed in offline mode. Offline / CI runs replay existing locked snapshots; a successful rebuild does not necessarily mean a new download.</div>
    {!local ? <p className="mt-4 text-muted">Open this project with <code>portolan dev</code> to view and edit its Git source configuration. Repository settings are not exposed by this published catalog.</p> : <>
      {state ? <ProjectRepositories workspaceKey={state.workspaceKey} projectTitle={projectTitle} repositories={repositories} available={available} connected={connected} disabled={busy || !!runId || !!draft} onConnect={openDraft} onManual={() => openDraft()} activeRepository={draft ? editorTarget : null} expanded={editorExpanded} editor={draftEditor} editingLocked={busy || !!runId} onToggle={() => setEditorExpanded((value) => !value)} /> : null}
      {state?.discoveryWarnings?.map((warning) => <p key={warning} role="status" className="mt-2 text-xs text-unresolved">{warning}</p>)}
      <SettingsReveal open={!!draft && editorTarget === null} label="Add repository by URL">{draft && editorTarget === null ? <div className="mt-4 rounded-control border border-line bg-surface p-4">{draftEditor}</div> : null}</SettingsReveal>
      {entries.length ? <h3 className="mt-6 border-t border-line pt-4 font-semibold">Configured connections</h3> : null}
      <div className="mt-4 space-y-2">{entries.map((entry) => {
        const active = !!draft && editorTarget === `step:${entry.step}`;
        const open = active && editorExpanded;
        return <div key={entry.step} className="rounded-control border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1"><div className="break-all font-medium">{entry.output || `Fetch step ${entry.step + 1}`}</div><p className="mt-1 break-words text-xs text-muted">{entry.error ?? entry.repos.map((repo) => `${repo.repo} · ${repo.commit?.slice(0, 8) || repo.ref || "HEAD"}`).join(" / ")}</p></div>
            <button type="button" className={`tbtn px-2 py-1 ${open ? "tbtn-on" : ""}`} aria-expanded={open} aria-controls={`git-step-editor-${entry.step}`} disabled={!!entry.error || busy || !!runId || (!!draft && !active)} onClick={() => {
              if (active) { setEditorExpanded((value) => !value); return; }
              setError(""); setMessage(""); setEditorTarget(`step:${entry.step}`); setEditorExpanded(true);
              setDraft({ step: entry.step, output: entry.catalogs.some((id) => id !== catalog) ? projectGitOutput(state!, catalog, entry.repos[0]?.repo) : entry.output, repos: structuredClone(entry.repos), catalog });
            }}>Configure<SettingsChevron open={open} /></button>
            <button type="button" className="tbtn px-2 py-1" disabled={!!entry.error || busy || !!runId || !!draft} onClick={() => void save(true, { step: entry.step, output: entry.output, repos: entry.repos, catalog })}><Download size={14} aria-hidden />Fetch & rebuild</button>
          </div>
          <SettingsReveal id={`git-step-editor-${entry.step}`} open={open} label={`Settings for fetch step ${entry.step + 1}`}><div className="mt-4 border-t border-line p-1 pt-4">{active ? draftEditor : null}</div></SettingsReveal>
        </div>;
      })}</div>
      {!state && !error ? <p role="status" className="mt-4 text-muted">Loading Git sources…</p> : null}
      {state && !entries.length && !draft ? <p className="mt-4 text-muted">No Git connection configured for this project.</p> : null}
      {!draft ? errorNotice : null}
      {message ? <p role="status" className="mt-3 break-words text-muted">{message}{done ? <button type="button" className="tbtn ml-2 px-2 py-1" onClick={() => window.location.reload()}>Reload catalog</button> : null}</p> : null}
      {runId ? <button type="button" className="tbtn mt-3 px-2 py-1" onClick={() => void cancelGeneration(runId).catch((cause: unknown) => setError(String(cause)))}>Cancel run</button> : null}
    </>}
    <div className="mt-4 border-t border-line pt-3 text-xs text-muted">Fetching runs the full extraction and generation pipeline and may contact configured services. Git snapshots do not enable commit scanning by themselves. <Link className="text-accent hover:underline" to={`${paths.pluginSettings("work-items")}?catalog=${encodeURIComponent(activeCatalogProfile.id)}`}>See task tracker Git-history requirements →</Link></div>
  </section>;
}
