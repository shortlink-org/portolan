// On an entity's page, every shown draft that touches it, with the version
// switch. With a branch picked, the page below reads that branch's version.

import { Link } from "react-router";
import { paths } from "../routes";
import { useDraftsTouching } from "./store";
import { useVersion } from "./version-param";
import { DraftChip, StateChip } from "./ui";

export function DraftBanner({ id, className = "" }: { id: string; className?: string }) {
  const touching = useDraftsTouching(id);
  const [version, setPicked] = useVersion();
  const picked = touching.some(({ draft }) => draft.branch === version) ? version : "main";
  if (touching.length === 0) return null;

  const versions = ["main", ...touching.map(({ draft }) => draft.branch)];
  const current = touching.find(({ draft }) => draft.branch === picked);

  return (
    <div className={`rounded-control border border-dashed border-accent/40 bg-accent/5 px-3 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-muted">version</span>
        <div className="mono flex overflow-hidden rounded-control border border-line text-xs">
          {versions.map((version) => (
            <button
              key={version}
              type="button"
              aria-pressed={picked === version}
              onClick={() => setPicked(version)}
              className={`px-2 py-1 ${picked === version ? "bg-accent/15 text-accent" : "bg-canvas text-muted hover:text-ink"}`}
            >
              {version}
            </button>
          ))}
        </div>
        {touching.map(({ draft, entity }) => (
          <span key={draft.branch} className="flex items-center gap-1.5">
            <DraftChip branch={draft.branch} />
            <StateChip state={entity.state} />
          </span>
        ))}
        <span className="ml-auto" />
        {touching.map(({ draft }) => (
          <Link key={draft.branch} to={paths.draftCompare(draft.project, draft.branch)} className="mono text-xs text-accent hover:underline">
            compare {draft.branch} →
          </Link>
        ))}
      </div>

      {touching.length > 1 ? (
        <div className="mono mt-2 flex flex-wrap items-center gap-2 rounded-control border border-unresolved/30 bg-unresolved/5 px-2 py-1 text-xs text-unresolved">
          <span>
            {touching.length} branches change this {touching[0]!.entity.kind}: {touching.map(({ draft }) => draft.branch).join(", ")}
          </span>
          <span className="text-muted">
            whichever lands second will have to take the other's change into account
          </span>
        </div>
      ) : null}

      {current ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <div className="mono text-[10px] uppercase tracking-wide text-accent">in {current.draft.branch}</div>
            <ul className="mono mt-1 flex flex-col gap-0.5 text-xs text-ink">
              {current.entity.branch.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          {current.entity.state === "conflict" ? (
            <div>
              <div className="mono text-[10px] uppercase tracking-wide text-unresolved">main changed it too, since {current.draft.base}</div>
              <ul className="mono mt-1 flex flex-col gap-0.5 text-xs text-ink">
                {(current.entity.main ?? []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : touching.length > 1 ? (
            <div>
              {touching
                .filter(({ draft }) => draft.branch !== current.draft.branch)
                .map(({ draft, entity }) => (
                  <div key={draft.branch}>
                    <div className="mono text-[10px] uppercase tracking-wide text-unresolved">also in {draft.branch}</div>
                    <ul className="mono mt-1 flex flex-col gap-0.5 text-xs text-ink">
                      {entity.branch.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ) : (
            <div className="mono self-end text-[10px] text-muted">{current.entity.kind === "flow"
              ? "the steps and the canvas below are the branch version; + ~ − ! mark what differs"
              : current.entity.kind === "event"
                ? "the schema below is the branch version; new, changed and removed are against main"
                : current.entity.kind === "aggregate"
                  ? "the operations and the root below are the branch version; marks say what differs"
                  : "the integrations below are the branch version; draft systems are marked"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
