import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, CircleCheck, CircleDashed, CircleX, Clock3, FolderGit2, Pencil, LoaderCircle, Plus } from "lucide-react";
import { Select } from "../../components/Select";
import { SettingsChevron, SettingsReveal } from "./SettingsReveal";
import { FloatingPortal, autoUpdate, flip, offset, shift, safePolygon, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from "@floating-ui/react";
import { checkGitRepositoryAccess } from "../../lib/local-api";
import type { GitAccessResult } from "../../lib/local-api";
import type { KnownGitRepository } from "../../lib/git-fetch-config.mjs";
import { readGitAccess, rememberGitAccess } from "../../lib/git-access-memory";
import type { RememberedGitAccess } from "../../lib/git-access-memory";

const ACCESS_STYLE = {
  unchecked: { label: "Not checked", Icon: CircleDashed, badge: "border-line-strong bg-canvas text-muted", edge: "border-l-line-strong" },
  checking: { label: "Checking", Icon: LoaderCircle, badge: "border-accent/30 bg-accent/10 text-accent", edge: "border-l-accent" },
  accessible: { label: "Read access confirmed", Icon: CircleCheck, badge: "border-verified/30 bg-verified/10 text-verified", edge: "border-l-verified" },
  unavailable: { label: "Access check failed", Icon: CircleX, badge: "border-unresolved/30 bg-unresolved/10 text-unresolved", edge: "border-l-unresolved" },
} as const;

function LastCheckedBadge({ checkedAt }: { checkedAt: string }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: "top", strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, handleClose: safePolygon(), delay: { open: 100, close: 80 } });
  const focus = useFocus(context);
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role]);
  const formatted = new Date(checkedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "long" });
  return <>
    <button type="button" ref={refs.setReference} aria-label={`Last checked: ${formatted}`} className={`inline-flex size-7 shrink-0 items-center justify-center rounded-control border text-muted hover:border-accent/50 hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${open ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-canvas"}`} {...getReferenceProps()}>
      <Clock3 size={14} aria-hidden />
      <time className="sr-only" dateTime={checkedAt}>{formatted}</time>
    </button>
    {open ? <FloatingPortal><div ref={refs.setFloating} style={floatingStyles} className="z-50 max-w-[calc(100vw-1rem)] rounded-control border border-line-strong bg-canvas px-3 py-2 text-xs text-ink shadow-md" {...getFloatingProps()}>
      <div className="font-medium">Last checked</div>
      <time className="mt-1 block" dateTime={checkedAt}>{formatted}</time>
      <span className="mono mt-1 block break-all text-muted">{checkedAt}</span>
    </div></FloatingPortal> : null}
  </>;
}

export function RepositoryAccessStatus({ result, checking = false }: { result?: GitAccessResult & { checkedAt?: string }; checking?: boolean }) {
  const state = checking ? "checking" : result?.status ?? "unchecked";
  const { label, Icon, badge } = ACCESS_STYLE[state];
  return <div role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
    <span className="inline-flex items-center gap-1.5"><span className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-xs font-medium ${badge}`}><Icon size={14} aria-hidden className={checking ? "motion-safe:animate-spin" : undefined} />{label}</span>
      {!checking && result?.checkedAt ? <LastCheckedBadge checkedAt={result.checkedAt} /> : null}
    </span>
    <span className="min-w-0 text-xs text-muted">{checking ? "Checking Git read access…" : result?.message ?? "Access not checked for this address."}</span>
  </div>;
}

type InlineEditor = { activeRepository?: string | null; expanded?: boolean; editor?: ReactNode; editingLocked?: boolean; onToggle?: () => void };

function RepositoryRow({ workspaceKey, repository, connected, disabled, onConnect, activeRepository, expanded, editor, editingLocked, onToggle }: { workspaceKey: string; repository: KnownGitRepository; connected: boolean; disabled: boolean; onConnect: (url: string) => void } & InlineEditor) {
  const active = activeRepository === repository.identity;
  const open = active && !!expanded;
  const editorId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => { if (wasOpen.current && !open) editButton.current?.focus(); wasOpen.current = open; }, [open]);
  const [saved] = useState(() => readGitAccess(workspaceKey, repository.identity));
  const [transport, setTransport] = useState(saved.transport && repository.urls[saved.transport] ? saved.transport : repository.transport);
  const [results, setResults] = useState<Record<string, RememberedGitAccess>>(saved.results);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkError, setCheckError] = useState("");
  const url = repository.urls[transport]!;
  const result = results[url];
  const state = checking ? "checking" : result?.status ?? "unchecked";
  const check = async () => {
    if (checking) return;
    setChecking(url); setCheckError("");
    try {
      const result = { ...await checkGitRepositoryAccess(url), checkedAt: new Date().toISOString() };
      rememberGitAccess(workspaceKey, repository.identity, transport, { url, result });
      setResults((current) => ({ ...current, [url]: result }));
    }
    catch { setCheckError("Could not run the access check. Verify the local server is running. The previous result has been kept."); }
    finally { setChecking(null); }
  };
  return <li className={`min-w-0 rounded-control border border-line border-l-4 bg-surface p-4 ${ACCESS_STYLE[state].edge}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-64"><div className="flex items-start gap-2"><FolderGit2 size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden /><div className="flex min-w-0 flex-wrap items-center gap-2"><h4 className="break-all font-semibold">{repository.identity}</h4>{connected ? <span className="chip inline-flex items-center gap-1"><Check size={12} aria-hidden />Configured</span> : null}</div></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Select label={`Transport for ${repository.identity}`} value={transport} disabled={!!checking} onChange={(value) => { const next = value as "https" | "ssh"; setTransport(next); setCheckError(""); rememberGitAccess(workspaceKey, repository.identity, next); }} className="min-w-24 px-2.5 py-1.5" options={[
          ...(repository.urls.https ? [{ value: "https", label: "HTTPS", note: "Git credential helper" }] : []),
          ...(repository.urls.ssh ? [{ value: "ssh", label: "SSH", note: "SSH key / agent" }] : []),
        ]} />
        <button type="button" className="tbtn px-2.5 py-1.5" disabled={!!checking} onClick={() => void check()}>{checking ? <LoaderCircle size={14} aria-hidden /> : <Check size={14} aria-hidden />}{checking ? "Checking…" : "Check access"}</button>
        <button ref={editButton} type="button" className={`tbtn px-2.5 py-1.5 ${open ? "tbtn-on" : ""}`} aria-expanded={open} aria-controls={editorId} disabled={editingLocked || (!active && (disabled || connected))} onClick={() => active ? onToggle?.() : onConnect(url)}><Pencil size={14} aria-hidden />Edit<SettingsChevron open={open} /></button>
      </div>
    </div>
    <code className="mt-3 block break-all text-xs text-muted">{url}</code>
    <RepositoryAccessStatus result={result} checking={!!checking} />
    {checkError ? <p role="alert" className="mt-2 text-xs text-unresolved">{checkError}</p> : null}
    <SettingsReveal id={editorId} open={open} label={`Settings for ${repository.identity}`}><div className="mt-4 border-t border-line p-1 pt-4">{active ? editor : null}</div></SettingsReveal>
  </li>;
}

export function ProjectRepositories({ workspaceKey, projectTitle, repositories, available = [], connected, disabled, onConnect, onManual, ...inlineEditor }: { workspaceKey: string; projectTitle?: string; repositories: KnownGitRepository[]; available?: KnownGitRepository[]; connected: Set<string>; disabled: boolean; onConnect: (url: string) => void; onManual: () => void } & InlineEditor) {
  const [showAvailable, setShowAvailable] = useState(false);
  const availableId = useId();
  return <section aria-labelledby="project-repositories-title" className="mt-6 border-t border-line pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="project-repositories-title" className="font-semibold">Project repositories{projectTitle ? <span className="ml-2 font-normal text-muted">· {projectTitle}</span> : null}</h3><div className="flex flex-wrap gap-2">{available.length ? <button type="button" className="tbtn px-3 py-1.5" disabled={disabled} aria-expanded={showAvailable} aria-controls={availableId} onClick={() => setShowAvailable((value) => !value)}>Connect existing<SettingsChevron open={showAvailable} /></button> : null}<button type="button" className="product-primary" disabled={disabled} onClick={onManual}><Plus size={14} aria-hidden />Add repository by URL</button></div></div>
    <p className="mt-2 text-sm text-muted">Repositories known to this project. Edit expands settings inside the card; nothing is saved or downloaded until you confirm.</p>
    {repositories.length ? <ul aria-label="Current project repositories" className="mt-4 space-y-3">{repositories.map((repository) => <RepositoryRow key={`${workspaceKey}:${repository.identity}`} workspaceKey={workspaceKey} repository={repository} connected={connected.has(repository.identity)} disabled={disabled} onConnect={onConnect} {...inlineEditor} />)}</ul> : <p className="mt-4 text-muted">No supported repository addresses found for this project. Connect an existing repository or add a URL.</p>}
    <SettingsReveal id={availableId} open={showAvailable} label="Connect an existing repository"><div className="mt-4 border-t border-line p-1 pt-4">
      <h4 className="font-medium">Connect an existing repository</h4>
      <p className="mt-1 text-sm text-muted">Known elsewhere in this workspace. Saving creates a connection for {projectTitle ?? "this project"}; other projects keep their settings.</p>
      <ul aria-label="Available repositories" className="mt-3 space-y-3">{available.map((repository) => <RepositoryRow key={`${workspaceKey}:${repository.identity}`} workspaceKey={workspaceKey} repository={repository} connected={false} disabled={disabled} onConnect={onConnect} {...inlineEditor} />)}</ul>
    </div></SettingsReveal>
    <p className="mt-3 text-xs text-muted">Transport alternatives are suggestions. Check access uses your Git credentials or SSH agent; an unknown SSH host must first be verified in your terminal.</p>
  </section>;
}
