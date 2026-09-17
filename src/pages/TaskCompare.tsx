// One task across the projects it touches: a ticket is worked on in four
// repositories, and its drafts share a name and nothing else. This is the page
// that puts them together (portolan.0019).

import { GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import { EntityRows, NothingRead } from "../drafts/EntityRows";
import { draftKey, taskCounts, tasksOf } from "../drafts/model";
import type { DraftState } from "../drafts/model";
import { useDrafts } from "../drafts/store";
import { STATES, STATE_LABEL, STATE_TONE, when } from "../drafts/ui";
import { paths } from "../routes";

export function TaskCompare() {
  const { task: encoded = "" } = useParams();
  const key = decodeURIComponent(encoded);
  useDocumentTitle(`Compare ${key}`);
  const drafts = useDrafts((state) => state.drafts);
  const enabled = useDrafts((state) => state.enabled);
  const toggleTask = useDrafts((state) => state.toggleTask);
  const task = tasksOf(drafts).find((candidate) => candidate.key === key);
  const [active, setActive] = useState<Set<DraftState>>(() => new Set(STATES));
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (task?.drafts ?? []).map((draft) => ({
      draft,
      entities: draft.entities.filter(
        (entity) => active.has(entity.state) && (!text || `${entity.id} ${entity.name} ${entity.branch.join(" ")}`.toLowerCase().includes(text)),
      ),
    }));
  }, [active, query, task]);

  if (!task) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="empty">
          No saved draft of <span className="mono text-ink">{key}</span>.{" "}
          <Link to={paths.drafts()} className="text-accent hover:underline">
            all branches
          </Link>
        </div>
      </div>
    );
  }

  const n = taskCounts(task);
  const total = task.drafts.reduce((sum, draft) => sum + draft.entities.length, 0);
  const found = shown.reduce((sum, { entities }) => sum + entities.length, 0);
  const all = task.drafts.every((draft) => enabled.includes(draftKey(draft)));
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
              · task
            </div>
            <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <GitBranch size={18} aria-hidden className="text-muted" />
              {task.key}
            </h1>
            <div className="mono mt-1 text-xs text-muted">
              {task.drafts.length} project{task.drafts.length === 1 ? "" : "s"} · {task.branches.join(", ")}
            </div>
          </div>
          <div className="ml-auto flex flex-col items-end gap-2">
            <label className="mono flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={all} onChange={() => toggleTask(task.key)} className="accent-[var(--accent)]" />
              show the whole task in the catalog
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
            <Search size={14} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <span className="sr-only">Filter entities</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter entities"
              className="mono w-full rounded-control border border-line bg-canvas py-2 pr-3 pl-8 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <span className="mono text-muted">
            {found} of {total} entities
          </span>
        </div>

        {shown.map(({ draft, entities }) => (
          <div key={draftKey(draft)} className="mt-section">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
              <h2 className="font-medium text-ink">{draft.projectName}</h2>
              <Link to={paths.draftCompare(draft.project, draft.branch)} className="mono text-xs text-accent hover:underline">
                {draft.branch} →
              </Link>
              <span className="mono text-xs text-muted">
                {draft.base} → {draft.tip}
              </span>
              <span className="mono ml-auto text-xs text-muted">saved {when(draft.savedAt)}</span>
            </div>
            {draft.entities.length === 0 ? (
              <NothingRead draft={draft} />
            ) : entities.length === 0 ? (
              <div className="empty mt-4">Nothing in {draft.projectName} matches these filters.</div>
            ) : (
              <EntityRows draft={draft} entities={entities} />
            )}
          </div>
        ))}

        <div className="mono mt-section flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
          <span>each project compared from its own base, overlaid on the current main</span>
        </div>
      </div>
    </div>
  );
}
