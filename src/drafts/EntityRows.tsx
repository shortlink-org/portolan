// What a draft did to the entities it touched, grouped by kind: the rows one
// branch's compare page shows, and the rows a whole task's page shows once per
// project (portolan.0019).

import { ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { paths } from "../routes";
import type { Draft, DraftEntity, DraftEntityKind } from "./model";
import { useDrafts } from "./store";
import { DraftChip, StateChip } from "./ui";
import { versionHref } from "./version-param";

export const KIND_LABEL: Record<DraftEntityKind, string> = {
  flow: "Flows",
  service: "Services",
  aggregate: "Aggregates",
  event: "Events",
};

export const KINDS: DraftEntityKind[] = ["flow", "service", "aggregate", "event"];

export function EntityRows({ draft, entities }: { draft: Draft; entities: DraftEntity[] }) {
  const drafts = useDrafts((state) => state.drafts);
  return (
    <>
      {KINDS.filter((kind) => entities.some((entity) => entity.kind === kind)).map((kind) => (
        <section key={kind} className="mt-section">
          <h2 className="label mb-2">{KIND_LABEL[kind]}</h2>
          <div className="flex flex-col gap-1">
            {entities
              .filter((entity) => entity.kind === kind)
              .map((entity) => (
                <div key={entity.id} id={`draft-${entity.id}`} className="row items-start gap-3 rounded-control px-3 py-2.5">
                  <StateChip state={entity.state} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {entity.state === "added" ? (
                        <Link to={paths.draftEntity(draft.project, draft.branch, entity.id)} className="font-medium text-ink hover:underline">
                          {entity.name}
                        </Link>
                      ) : entity.href ? (
                        <Link to={versionHref(entity.href, draft.branch)} className={`font-medium hover:underline ${entity.state === "removed" ? "text-muted line-through" : "text-ink"}`}>
                          {entity.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{entity.name}</span>
                      )}
                      {entity.state === "added" ? <DraftChip branch={draft.branch} /> : null}
                      <span className="mono text-xs text-muted">{entity.id}</span>
                      {drafts
                        .filter((other) => other !== draft && other.entities.some((candidate) => candidate.id === entity.id))
                        .map((other) => (
                          <Link
                            key={`${other.project}:${other.branch}`}
                            to={paths.draftCompare(other.project, other.branch)}
                            className="mono rounded-sm border border-unresolved/30 bg-unresolved/5 px-1.5 py-0.5 text-[10px] text-unresolved hover:underline"
                            title={`${other.branch} changes this too`}
                          >
                            also in {other.branch}
                          </Link>
                        ))}
                    </div>
                    {entity.main ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <Side title={`in ${draft.branch}`} lines={entity.branch} tone="text-accent" />
                        <Side
                          title="on main since the base"
                          lines={entity.main}
                          tone={entity.state === "conflict" ? "text-unresolved" : "text-declared"}
                        />
                      </div>
                    ) : (
                      <ul className="mono mt-1 flex flex-col gap-0.5 text-xs text-muted">
                        {entity.branch.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * A draft with no entities: the branch changed files and the catalog reads
 * none of it. Said with the count and a way to the diff, or it reads as a
 * draft that failed rather than a finding about the model.
 */
export function NothingRead({ draft }: { draft: Draft }) {
  return (
    <div className="empty mt-4">
      <p>Nothing the catalog reads changed in {draft.projectName}.</p>
      {draft.touched ? (
        <p className="mono mt-2 text-xs text-muted">
          The branch changed {draft.touched.files} file{draft.touched.files === 1 ? "" : "s"} in {draft.touched.dirs.join(", ")} — none of it is something an
          extractor of this estate models.
        </p>
      ) : null}
      {draft.diffHref ? (
        <p className="mono mt-2 text-xs">
          <a href={draft.diffHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-accent hover:underline">
            see the diff on the forge <ExternalLink size={11} aria-hidden />
          </a>
        </p>
      ) : null}
    </div>
  );
}

function Side({ title, lines, tone }: { title: string; lines: string[]; tone: string }) {
  return (
    <div className="rounded-control border border-line bg-canvas p-2">
      <div className={`mono text-[10px] uppercase tracking-wide ${tone}`}>{title}</div>
      <ul className="mono mt-1 flex flex-col gap-0.5 text-xs text-muted">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
