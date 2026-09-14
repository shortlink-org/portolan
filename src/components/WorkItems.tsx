import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ExternalLink, Ticket, X } from "lucide-react";
import type { Catalog, WorkItemLink, WorkItemTarget } from "../catalog";
import { relatedWorkItems } from "../lib/work-items";
import { CommitLink } from "./CommitLink";

const basisLabel = {
  declared: "Declared link",
  "source-file": "Source file changed",
  "service-directory": "Service directory changed",
};

/** A compact entry point to the task AND the evidence, with working keyboard/touch access. */
export function WorkItems({ catalog, target, className = "", variant = "chips" }: { catalog: Catalog; target: WorkItemTarget; className?: string; variant?: "chips" | "summary" }) {
  const rows = relatedWorkItems(catalog, target);
  if (!rows.length) return null;
  const visibleCount = variant === "summary" ? 1 : 2;
  const groups = [...rows.slice(0, visibleCount).map((row) => [row]), ...(rows.length > visibleCount ? [rows.slice(visibleCount)] : [])];
  return <span className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 ${className}`} aria-label="Related work">
    {groups.map((group, at) => <Popover key={at} className="inline-flex min-w-0 max-w-full">
      <PopoverButton className={`${variant === "summary" ? "inline-flex items-center gap-2 rounded-control px-2 py-1 text-xs hover:bg-raised" : "chip"} min-w-0 max-w-full border-line text-accent hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`} aria-label={at < visibleCount ? `Related task ${group[0]!.item.key}` : `${group.length} more related tasks`}>
        {at < visibleCount || variant === "chips" ? <Ticket size={12} className="shrink-0" aria-hidden /> : null}
        {at < visibleCount ? <>
          <span className="shrink-0 whitespace-nowrap font-mono">{group[0]!.item.key}</span>
          {group[0]!.item.title ? <span className={`min-w-0 truncate ${variant === "summary" ? "max-w-64 text-ink" : "max-w-40 text-muted"}`}>{variant === "chips" ? "· " : ""}{group[0]!.item.title}</span> : null}
          {variant === "summary" && group[0]!.item.status ? <span className="max-w-28 shrink-0 truncate border-l border-line pl-2 text-muted" title={`Task status snapshot${group[0]!.item.updatedAt ? ` · ${group[0]!.item.updatedAt}` : ""}`}>{group[0]!.item.status}</span> : null}
        </> : `+${group.length}${variant === "summary" ? ` ${group.length === 1 ? "task" : "tasks"}` : ""}`}
      </PopoverButton>
      <PopoverPanel anchor={{ to: "bottom start", gap: 6, padding: 8 }} className="z-50 w-[27rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-card border border-line-strong bg-canvas text-ink shadow-md focus:outline-none">
        {({ close }) => <>
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="label text-muted">Related work · {group.length}</span>
            <button type="button" onClick={() => close()} aria-label="Close related work" className="tbtn"><X size={14} aria-hidden /></button>
          </div>
          <div className="max-h-[min(32rem,65vh)] divide-y divide-line overflow-y-auto">
            {group.map(({ item, links }) => <section key={item.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <a className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline" href={item.url} target="_blank" rel="noreferrer">{item.key}<ExternalLink size={13} aria-hidden /></a>
                <span className="ml-auto text-xs text-muted">{item.provider === "youtrack" ? "YouTrack" : item.provider} · {item.tracker}</span>
              </div>
              {item.title ? <p className="mt-2 font-medium">{item.title}</p> : <p className="mt-2 text-muted">Open the task for its description and status.</p>}
              {item.status || item.assignee ? <div className="mt-2 flex flex-wrap gap-2 text-xs">{item.status ? <span className="chip">{item.status}</span> : null}{item.assignee ? <span className="text-muted">Assigned to {item.assignee}</span> : null}</div> : null}
              {item.updatedAt ? <p className="mt-1 text-xs text-faint">Task snapshot · {item.updatedAt}</p> : null}
              {links.map((link) => <Evidence key={link.basis} link={link} />)}
            </section>)}
          </div>
        </>}
      </PopoverPanel>
    </Popover>)}
  </span>;
}

function Evidence({ link }: { link: WorkItemLink }) {
  return <div className="mt-3 border-t border-line pt-3">
    <div className="flex items-center justify-between gap-2 text-xs"><span className="font-medium">{basisLabel[link.basis]}</span><span className="text-muted">{link.commits.length} {link.commits.length === 1 ? "commit" : "commits"}</span></div>
    {link.basis !== "declared" ? <p className="mt-1 text-xs text-muted">The commit mentions this task and touches {link.basis === "source-file" ? "a source file used here. The specific step may be unchanged." : "this service’s directory."}</p> : !link.commits.length ? <p className="mt-1 text-xs text-muted">Explicitly associated with this entity; no commit recorded.</p> : null}
    <ol className="mt-2 space-y-3">
      {[...link.commits].sort((a, b) => b.date.localeCompare(a.date) || a.sha.localeCompare(b.sha)).map((commit) => <li key={`${commit.repository}:${commit.sha}`} className="rounded-control border border-line bg-surface p-2.5">
        <p className="break-words text-sm">{commit.subject}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><CommitLink commit={commit.sha} repository={commit.repository} /><span>{commit.author}</span><time dateTime={commit.date} title={commit.date}>{commit.date.slice(0, 10)}</time></div>
        <p className="mt-1 break-all text-xs text-faint">{commit.repository.replace(/^https?:\/\//, "")}</p>
        <ul className="mt-2 space-y-1 border-t border-line pt-2 font-mono text-xs text-muted">{commit.paths.map((path) => <li key={path} className="break-all">{path}</li>)}</ul>
      </li>)}
    </ol>
  </div>;
}
