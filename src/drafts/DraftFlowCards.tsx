// A flow a shown draft adds sits among main's flows, as
// a card of its own, dashed and marked with its branch.

import { Link } from "react-router";
import { paths } from "../routes";
import { useEnabledDrafts } from "./store";
import { DraftChip } from "./ui";

export function DraftFlowCards() {
  const added = useEnabledDrafts().flatMap((draft) =>
    draft.entities.filter((e) => e.kind === "flow" && e.state === "added").map((entity) => ({ draft, entity })),
  );

  return (
    <>
      {added.map(({ draft, entity }) => (
        <div key={`${draft.branch}:${entity.id}`} className="card border-dashed border-accent/50" style={{ borderLeftWidth: 3 }}>
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              to={paths.draftEntity(draft.project, draft.branch, entity.id)}
              className="card-link rounded-control font-semibold"
            >
              {entity.name}
            </Link>
            <span className="mono text-xs text-muted">{entity.id}</span>
            <span className="ml-auto">
              <DraftChip branch={draft.branch} />
            </span>
          </div>
          <ul className="mono mt-2 flex flex-col gap-0.5 text-xs text-muted">
            {entity.branch.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mono mt-4 text-xs text-muted">
            {draft.projectName} · only in {draft.branch}
          </div>
        </div>
      ))}
    </>
  );
}
