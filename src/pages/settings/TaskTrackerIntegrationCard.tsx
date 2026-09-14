import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Ticket } from "lucide-react";
import { TaskTrackerIcon } from "../../components/TaskTrackerIcon";
import { activeCatalogProfile } from "../../data";
import { taskTrackerSettings } from "../../lib/local-api";
import { setupInfo } from "../../lib/setup-info";
import { TRACKER_PROVIDERS } from "../../lib/task-tracker-config.mjs";
import type { TaskTrackerEntry } from "../../lib/task-tracker-config.mjs";
import { paths } from "../../routes";

export function TaskTrackerIntegrationCard({ local }: { local: boolean }) {
  const [entries, setEntries] = useState<TaskTrackerEntry[] | null>(local ? null : setupInfo.taskTrackers ?? []);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!local) { setEntries(setupInfo.taskTrackers ?? []); return; }
    let cancelled = false;
    setEntries(null); setError(false);
    taskTrackerSettings().then((state) => { if (!cancelled) setEntries(state.entries); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [local]);
  const connected = entries?.filter((entry) => entry.trackers.length);
  const providers = [...new Set(connected?.flatMap((entry) => entry.trackers.map((tracker) => tracker.provider)))];
  const shownProviders = providers.length ? providers : Object.keys(TRACKER_PROVIDERS) as Array<keyof typeof TRACKER_PROVIDERS>;
  return <section className="min-w-0 rounded-card border border-line bg-canvas p-card shadow-xs lg:col-span-2">
    <div className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface"><Ticket size={18} aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">Task trackers</h2><span className="chip text-muted">{error ? "unavailable" : !entries ? "loading" : connected?.length ? `${connected.length} ${connected.length === 1 ? "repository" : "repositories"}` : "not configured"}</span></div>
        <p className="mt-1 text-muted">Connect tasks to flows and commit evidence. Manage repositories, detection rules and history scans on a dedicated page.</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={providers.length ? "Configured providers" : "Supported providers"}>
      {shownProviders.map((provider) => <span key={provider} className="inline-flex items-center gap-1.5 text-sm text-muted"><TaskTrackerIcon provider={provider} />{TRACKER_PROVIDERS[provider].label}</span>)}
    </div>
    {error ? <p role="status" className="mt-3 text-sm text-unresolved">Could not read tracker configuration. Open settings to retry.</p> : null}
    <div className="mt-4 border-t border-line pt-3"><Link to={`${paths.pluginSettings("work-items")}?catalog=${encodeURIComponent(activeCatalogProfile.id)}`} className="tbtn inline-flex px-3 py-1.5">{local ? "Configure task trackers" : "View task trackers"}<ArrowRight size={14} aria-hidden /></Link></div>
  </section>;
}
