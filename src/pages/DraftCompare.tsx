// What one branch changed in one project, entity by entity, grouped by kind
// (portolan.0019).

import { ArrowRight, GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import { EntityRows, NothingRead } from "../drafts/EntityRows";
import { draftKey, taskOf } from "../drafts/model";
import type { DraftState } from "../drafts/model";
import { counts, useDrafts } from "../drafts/store";
import { STATES, STATE_LABEL, STATE_TONE, when } from "../drafts/ui";
import { paths } from "../routes";

export function DraftCompare() {
  const { project = "", branch: encoded = "" } = useParams();
  const branch = decodeURIComponent(encoded);
  useDocumentTitle(`Compare ${branch}`);
  const drafts = useDrafts((s) => s.drafts);
  const enabled = useDrafts((s) => s.enabled);
  const toggle = useDrafts((s) => s.toggle);
  const draft = drafts.find((d) => d.project === project && d.branch === branch);
  const [active, setActive] = useState<Set<DraftState>>(() => new Set(STATES));
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    if (!draft) return [];
    const q = query.trim().toLowerCase();
    return draft.entities.filter(
      (e) => active.has(e.state) && (!q || `${e.id} ${e.name} ${e.branch.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [active, draft, query]);

  if (!draft) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="empty">
          No saved draft of <span className="mono text-ink">{branch}</span> for {project}.{" "}
          <Link to={paths.drafts()} className="text-accent hover:underline">
            all branches
          </Link>
        </div>
      </div>
    );
  }

  const key = draftKey(draft);
  const n = counts(draft);
  const task = taskOf(draft.branch);
  // The same task in other projects: one ticket, one branch name, several
  // repositories, and no way to see them together without this.
  const elsewhere = drafts.filter((other) => other !== draft && taskOf(other.branch) === task);
  const flip = (state: DraftState) =>
    setActive((previous) => {
      const next = new Set(previous);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto p-gutter">
      <div>
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <div className="label">
              <Link to={paths.drafts()} className="hover:text-ink hover:underline">
                branch drafts
              </Link>{" "}
              · {draft.projectName}
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <GitBranch size={18} aria-hidden className="text-muted" />
              {draft.branch}
            </h1>
            {elsewhere.length > 0 ? (
              <div className="mono mt-1 text-xs text-muted">
                part of{" "}
                <Link to={paths.draftTask(task)} className="text-accent hover:underline">
                  {task}
                </Link>{" "}
                · also in {elsewhere.map((other) => other.projectName).join(", ")}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex flex-col items-end gap-2">
            <div className="mono flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm">
              <span className="text-muted" title="the commit the branch branched off">
                base {draft.base}
              </span>
              <ArrowRight size={14} aria-hidden className="text-line-strong" />
              <span className="text-ink">
                {draft.branch} {draft.tip}
              </span>
            </div>
            <label className="mono flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={enabled.includes(key)} onChange={() => toggle(key)} className="accent-[var(--accent)]" />
              show in the catalog
            </label>
          </div>
        </div>

        <div className="mt-section grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STATES.map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={active.has(state)}
              onClick={() => flip(state)}
              className={`rounded-control border p-3 text-left transition-opacity ${STATE_TONE[state]} ${active.has(state) ? "" : "opacity-40"}`}
            >
              <span className="tnum block text-xl font-semibold">{n[state]}</span>
              <span className="mono text-xs">{STATE_LABEL[state]}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-b border-line pb-3">
          <label className="relative min-w-52 flex-1">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <span className="sr-only">Filter entities</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter entities"
              className="mono w-full rounded-control border border-line bg-canvas py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <span className="mono text-muted">
            {shown.length} of {draft.entities.length} entities
          </span>
        </div>

        {draft.entities.length === 0 ? (
          <NothingRead draft={draft} />
        ) : shown.length === 0 ? (
          <div className="empty mt-4">No entities match these filters.</div>
        ) : (
          <EntityRows draft={draft} entities={shown} />
        )}

        <div className="mono mt-section flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
          <span>saved {when(draft.savedAt)}</span>
          <span>compared from base {draft.base}, overlaid on the current main</span>
        </div>
      </div>
    </div>
  );
}
