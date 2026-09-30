import { Link, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useDocumentTitle } from "../app/title";
import { Blank, Empty, Loading } from "../components/PageHeader";
import { PluginIcon } from "../components/PluginIcon";
import { pluginByName, pluginIcon, pluginLabel } from "../lib/plugins";
import { localStatusQuery } from "../lib/queries";
import { paths } from "../routes";
import { TaskTrackerSettings } from "./settings/TaskTrackerSettings";
import { EventBridgeSettings } from "./settings/EventBridgeSettings";
import { GitFetchSettings } from "./settings/GitFetchSettings";

/** Plugin-owned settings: deliberately outside the global Settings navigation. */
export function PluginSettings() {
  const { name = "" } = useParams();
  const { search } = useLocation();
  const entry = pluginByName(name);
  const status = useQuery(localStatusQuery());
  useDocumentTitle(`${entry ? pluginLabel(name) : "Plugin"} settings`);
  const back = entry ? `${paths.plugins()}${search}#plugin-${encodeURIComponent(name)}` : `${paths.plugins()}${search}`;
  return <div className="h-full overflow-y-auto p-gutter">
    <div className="max-w-table">
      <Link to={back} className="mb-4 inline-flex items-center gap-1.5 text-muted hover:text-ink"><ArrowLeft size={14} aria-hidden />Back to plugins</Link>
      <header className="mb-section flex items-start gap-3">
        {entry ? <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-line bg-surface"><PluginIcon icon={pluginIcon(name, entry.category)} size={20} /></span> : null}
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold">{entry ? pluginLabel(name) : "Plugin not found"}</h1>{entry ? <code className="chip text-muted">{name}</code> : null}</div><p className="mt-1 text-muted">Plugin settings</p></div>
      </header>
      {!entry ? <Empty>No plugin named <span className="mono text-ink">{name}</span> is in the catalog’s plugin index.</Empty>
        : !["work-items", "fetch-eventbridge", "fetch-git"].includes(entry.plugin) ? <Blank where="portolan.json">{pluginLabel(name)} has no dedicated settings page. Its options are described on its card in the <Link to={back} className="text-accent hover:underline">plugin index</Link> and set on its step in portolan.json.</Blank>
        : status.isPending ? <Loading className="min-h-48">Loading plugin settings: asking whether portolan dev serves this catalog, which decides if the form can save.</Loading>
        : entry.plugin === "fetch-eventbridge" ? <EventBridgeSettings local={status.isSuccess} /> : entry.plugin === "fetch-git" ? <GitFetchSettings local={status.isSuccess} /> : <TaskTrackerSettings local={status.isSuccess} />}
    </div>
  </div>;
}
