import { Link } from "react-router";
import { ArrowRight, Check, CircleAlert, FolderGit2, GitBranch, RefreshCw, ScanSearch, Ticket } from "lucide-react";
import { pluginIndex } from "../../lib/plugins";
import type { TaskTrackerState } from "../../lib/local-api";
import { paths } from "../../routes";

export function WorkItemGitRequirement({ repositories, local, catalog, refreshing = false, onRefresh }: {
  repositories?: TaskTrackerState["repositories"];
  local: boolean;
  catalog: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const ready = repositories?.filter((repository) => repository.available).length ?? 0;
  const unavailable = (repositories?.length ?? 0) - ready;
  const fetchPlugin = pluginIndex.find((entry) => entry.plugin === "fetch-git");
  const query = `?catalog=${encodeURIComponent(catalog)}`;
  return <section aria-label="Git history requirement" className="mt-4 min-w-0 rounded-control border border-line bg-surface p-4">
    <div className="flex flex-wrap items-center gap-2"><GitBranch size={16} aria-hidden /><h3 className="font-medium">Git history</h3><span className="chip text-muted">required</span><span className={`chip ${repositories && !ready ? "status-unresolved" : "text-muted"}`}>{!local ? "checked locally" : !repositories ? "not checked" : `${ready} ${ready === 1 ? "checkout" : "checkouts"} available`}</span></div>
    <ol aria-label="Task evidence pipeline" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-muted">
      <li className="inline-flex items-center gap-1.5"><FolderGit2 size={14} aria-hidden />Checkout + commits</li>
      <li className="inline-flex items-center gap-1.5"><ArrowRight size={12} aria-hidden /><ScanSearch size={14} aria-hidden />work-items scan</li>
      <li className="inline-flex items-center gap-1.5"><ArrowRight size={12} aria-hidden /><Ticket size={14} aria-hidden />Task evidence</li>
    </ol>
    <p className="mt-3 text-sm text-muted">Select a repository root with its own local commit history. Source folders and generated catalogs are not separate checkouts. Full scan reads local history; it does not fetch missing commits.</p>
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2"><span className="label">Related plugin</span>{fetchPlugin ? <Link to={`${paths.pluginSettings(fetchPlugin.name)}${query}`} className="inline-flex items-center gap-1.5 text-accent hover:underline"><FolderGit2 size={14} aria-hidden />fetch-git<ArrowRight size={13} aria-hidden /></Link> : <span className="mono text-muted">fetch-git</span>}<span className="chip text-muted">source snapshots only</span></div>
      <p className="mt-1.5 text-xs text-muted">fetch-git imports pinned source files, not a persistent .git history. It does not satisfy this requirement by itself. An existing checkout needs no fetch-git step.</p>
      <p className="mt-2 text-xs text-muted">To scan another repository, prepare a local checkout inside this workspace and register its root in Projects.</p>
      <Link to={`${paths.settingsProjects()}${query}`} className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline">Manage projects<ArrowRight size={13} aria-hidden /></Link>
    </div>
    {repositories ? <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-muted">Repository availability · {ready} available{unavailable ? ` · ${unavailable} unavailable` : ""}</summary>
      <ul className="mt-3 space-y-2">
        {repositories.map((repository) => <li key={repository.input} className="flex items-start gap-2 rounded-control border border-line bg-canvas p-2.5">
          {repository.available ? <Check size={14} className="mt-0.5 shrink-0 text-verified" aria-hidden /> : <CircleAlert size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />}
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{repository.label}</span><span className="chip text-muted">{!repository.available ? "unavailable" : repository.shallow ? "shallow history" : "available"}</span></div><code className="mt-1 block break-all text-xs text-muted">{repository.input}</code><p className="mt-1 text-xs text-muted">{!repository.available ? repository.reason ?? "No local Git checkout found." : repository.shallow ? "Only locally fetched commits can be scanned. Full scan cannot restore missing history." : "Local commit history is available for scanning."}</p></div>
        </li>)}
      </ul>
    </details> : null}
    {local && onRefresh ? <button type="button" className="tbtn mt-3 px-2 py-1 text-xs" disabled={refreshing} onClick={onRefresh}><RefreshCw size={12} aria-hidden />{refreshing ? "Checking…" : "Recheck Git availability"}</button> : null}
  </section>;
}
