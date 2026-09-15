// The line above a flow only a branch has, saying so.

import { GitBranch } from "lucide-react";
import { Link } from "react-router";
import { paths } from "../routes";
import type { Draft, DraftEntity } from "./model";
import { DraftChip, StateChip, when } from "./ui";

export function DraftOnlyStrip({ draft, entity, className = "" }: { draft: Draft; entity: DraftEntity; className?: string }) {
  return (
    <div className={`rounded-control border border-dashed border-accent/40 bg-accent/5 px-3 py-2 ${className}`}>
      <div className="mono flex flex-wrap items-center gap-2 text-xs text-muted">
        <GitBranch size={13} aria-hidden className="text-accent" />
        <DraftChip branch={draft.branch} />
        <StateChip state={entity.state} />
        <span>
          only in <span className="text-ink">{draft.branch}</span> · not on main · every {entity.kind === "flow" ? "step" : "field"} below is new
        </span>
        <span>
          {draft.projectName} · generated at {draft.tip}, saved {when(draft.savedAt)}
        </span>
        <Link to={`${paths.draftCompare(draft.project, draft.branch)}#draft-${entity.id}`} className="ml-auto text-accent hover:underline">
          compare {draft.branch} →
        </Link>
      </div>
    </div>
  );
}
