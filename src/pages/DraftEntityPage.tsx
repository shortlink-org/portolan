// An entity only a branch has, on a page of its own, laid
// out the way main's page of the same kind is.

import { EventPage } from "./EventPage";
import { WithDetail } from "../selection/DetailPanel";
import { FlowDetail } from "./FlowDetail";
import { GitBranch } from "lucide-react";
import { Link, useParams } from "react-router";
import { useDocumentTitle } from "../app/title";
import { KindIcon } from "../components/kind";
import { index } from "../data";
import { useDrafts } from "../drafts/store";
import { DraftChip, StateChip, when } from "../drafts/ui";
import { paths } from "../routes";

export function DraftEntityPage() {
  const { project = "", branch: encodedBranch = "", entity: encodedEntity = "" } = useParams();
  const branch = decodeURIComponent(encodedBranch);
  const entityId = decodeURIComponent(encodedEntity);
  const drafts = useDrafts((s) => s.drafts);
  const draft = drafts.find((d) => d.project === project && d.branch === branch);
  const entity = draft?.entities.find((e) => e.id === entityId);
  useDocumentTitle(entity ? `${entity.name} · ${branch}` : "Draft");

  if (!draft || !entity) {
    return (
      <div className="h-full overflow-y-auto p-gutter">
        <div className="empty">
          <span className="mono text-ink">{entityId}</span> is not in a saved draft of {branch}.{" "}
          <Link to={paths.drafts()} className="text-accent hover:underline">
            all branches
          </Link>
        </div>
      </div>
    );
  }

  if (entity.kind === "flow") {
    return (
      <WithDetail id="flow">
        <FlowDetail key={`${draft.branch}:${entity.id}`} draftOnly={{ draft, entity }} />
      </WithDetail>
    );
  }

  if (entity.kind === "event") {
    return <EventPage key={`${draft.branch}:${entity.id}`} draftOnly={{ draft, entity }} />;
  }

  const aggregate = entity.parent ? index.aggregateById.get(entity.parent) : undefined;
  const owner = entity.parent ? index.aggregateOwner.get(entity.parent) : undefined;
  const parent = aggregate && owner ? { aggregate, service: owner, context: index.serviceContext.get(owner.id) } : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-dashed border-accent/40 bg-accent/5 px-gutter py-2">
        <div className="mono flex flex-wrap items-center gap-2 text-xs text-muted">
          <GitBranch size={13} aria-hidden className="text-accent" />
          <span>
            only in <span className="text-ink">{draft.branch}</span> · {draft.projectName} · not on main
          </span>
          <span>
            generated at {draft.tip}, saved {when(draft.savedAt)}
          </span>
          <Link to={`${paths.draftCompare(draft.project, draft.branch)}#draft-${entity.id}`} className="ml-auto text-accent hover:underline">
            compare {draft.branch} →
          </Link>
        </div>
      </div>

      <div className="px-gutter pt-5 pb-4">
        <div className="label">
          {entity.kind}
          {parent?.context ? (
            <>
              {" · "}
              <Link to={paths.aggregate(parent.context.id, parent.service.slug, parent.aggregate.slug)} className="hover:text-ink hover:underline">
                {parent.aggregate.id}
              </Link>
            </>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <KindIcon kind={entity.kind} />
          <h1 className="text-lg font-semibold">{entity.name}</h1>
          <span className="mono text-muted">{entity.id}</span>
          <DraftChip branch={draft.branch} />
          <StateChip state={entity.state} />
        </div>
        {entity.summary ? <p className="mt-2 max-w-prose text-muted">{entity.summary}</p> : null}
      </div>

    </div>
  );
}
