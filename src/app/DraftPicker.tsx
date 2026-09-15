// Lay saved branch drafts over the catalog, one checkbox
// per project and branch, off until the reader ticks one.

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ChevronDown, GitPullRequestDraft } from "lucide-react";
import { Link } from "react-router";
import { draftKey } from "../drafts/model";
import { counts, useDrafts } from "../drafts/store";
import { STATES, STATE_TONE } from "../drafts/ui";
import { paths } from "../routes";

export function DraftPicker({ compact = false }: { compact?: boolean }) {
  const drafts = useDrafts((s) => s.drafts);
  const enabled = useDrafts((s) => s.enabled);
  const toggle = useDrafts((s) => s.toggle);
  const on = drafts.filter((d) => enabled.includes(draftKey(d))).length;
  const projects = [...new Set(drafts.map((d) => d.projectName))];

  return (
    <Popover className="relative">
      <PopoverButton
        aria-label={on ? `${on} drafts shown` : "Branch drafts"}
        title="Branch drafts"
        className={({ open }) =>
          compact
            ? `flex size-8 shrink-0 items-center justify-center rounded-control border t-micro transition-colors border-line hover:bg-surface ${open || on ? "text-accent" : "text-muted hover:text-ink"}`
            : `mono flex shrink-0 items-center gap-1.5 rounded-control border px-2 py-1.5 t-micro transition-colors ${open || on ? "border-accent text-accent" : "border-line text-muted hover:border-line-strong hover:bg-surface hover:text-ink"}`
        }
      >
        <GitPullRequestDraft size={16} aria-hidden className="shrink-0" />
        {!compact ? <span>drafts{on ? ` · ${on}` : ""}</span> : null}
        {!compact ? <ChevronDown size={13} aria-hidden /> : null}
      </PopoverButton>

      <PopoverPanel
        anchor={{ to: "bottom end", gap: 4, padding: 8 }}
        className="palette-in z-50 w-96 rounded-control border bg-canvas py-1 border-line-strong shadow-md focus:outline-none"
      >
        <div className="label px-3 pt-2 pb-1">show branch drafts in the catalog</div>
        {drafts.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted">No saved drafts yet.</div>
        ) : (
          projects.map((project) => (
            <div key={project} className="border-t border-line first-of-type:border-t-0">
              <div className="mono px-3 pt-2 text-xs text-muted">{project}</div>
              {drafts
                .filter((d) => d.projectName === project)
                .map((draft) => {
                  const key = draftKey(draft);
                  const n = counts(draft);
                  return (
                    <label key={key} className="mono flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-raised">
                      <input type="checkbox" checked={enabled.includes(key)} onChange={() => toggle(key)} className="accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate text-ink">{draft.branch}</span>
                      <span className="flex shrink-0 gap-1">
                        {STATES.filter((s) => n[s] > 0).map((s) => (
                          <span key={s} className={`tnum rounded-sm border px-1 text-[10px] ${STATE_TONE[s]}`} title={s}>
                            {n[s]}
                          </span>
                        ))}
                      </span>
                      <Link
                        to={paths.draftCompare(draft.project, draft.branch)}
                        className="shrink-0 text-xs text-accent hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        compare
                      </Link>
                    </label>
                  );
                })}
            </div>
          ))
        )}
        <div className="mt-1 border-t border-line px-3 py-2">
          <Link to={paths.drafts()} className="mono text-sm text-accent hover:underline">
            all branches →
          </Link>
        </div>
      </PopoverPanel>
    </Popover>
  );
}
