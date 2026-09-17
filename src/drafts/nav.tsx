// Shown drafts where a reader finds things - the sidebar
// tree, the command palette and an aggregate's event list.

import { GitBranch } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { Leaf } from "../app/SidebarTree";
import { KindIcon } from "../components/kind";
import type { PaletteItem } from "../lib/palette";
import { paths } from "../routes";
import { useAddedEntities, useDraftsTouching, useEnabledDrafts } from "./store";
import { StateChip } from "./ui";
import { versionHref } from "./version-param";

export function DraftFlowRows({ owner }: { owner: string }) {
  const added = useAddedEntities().filter(({ entity }) => entity.kind === "flow" && entity.owner === owner);
  return (
    <>
      {added.map(({ draft, entity }) => (
        <Leaf key={`${draft.branch}:${entity.id}`} to={paths.draftEntity(draft.project, draft.branch, entity.id)} depth={1} title={`${entity.name} — only in ${draft.branch}`}>
          <span className="opacity-70">
            <KindIcon kind="flow" />
          </span>
          <span className="truncate italic">{entity.name}</span>
          <span className="mono ml-auto flex shrink-0 items-center gap-1 pl-2 text-[10px] text-accent">
            <GitBranch size={10} aria-hidden />
            draft
          </span>
        </Leaf>
      ))}
    </>
  );
}

export function useDraftPaletteItems(): PaletteItem[] {
  const added = useAddedEntities();
  return useMemo(
    () =>
      added
        .filter(({ entity }) => entity.kind === "flow" || entity.kind === "event")
        .map(({ draft, entity }) => ({
          kind: entity.kind,
          id: `draft:${draft.branch}:${entity.id}`,
          name: entity.name,
          detail: `${entity.id} · only in ${draft.branch}`,
          path: paths.draftEntity(draft.project, draft.branch, entity.id),
          context: entity.owner,
          badge: `draft · ${draft.branch}`,
          keywords: [draft.branch, entity.id],
        })),
    [added],
  );
}

/** A state chip on an event row a shown draft changes or removes. */
export function DraftEventMark({ id }: { id: string }) {
  const touching = useDraftsTouching(id);
  if (touching.length === 0) return <span />;
  return (
    <span className="flex items-center gap-1">
      {touching.map(({ draft, entity }) => (
        <Link key={draft.branch} to={versionHref(entity.href ?? "", draft.branch)} title={`${entity.state} in ${draft.branch} — open that version`}>
          <StateChip state={entity.state} />
        </Link>
      ))}
    </span>
  );
}

/** Events a shown draft adds to this aggregate, as rows after main's. */
export function DraftEventRows({ aggregateId }: { aggregateId: string }) {
  const added = useAddedEntities().filter(({ entity }) => entity.kind === "event" && entity.parent === aggregateId);
  return (
    <>
      {added.map(({ draft, entity }) => (
        <div key={`${draft.branch}:${entity.id}`} className="row gap-2 border border-dashed border-accent/40 px-3 py-2">
          <KindIcon kind="event" />
          <Link to={paths.draftEntity(draft.project, draft.branch, entity.id)} className="mono rounded-control italic" style={{ color: "var(--kind-event)" }}>
            {entity.name}
          </Link>
          <span className="flex items-center gap-2">
            <span className="mono rounded-[4px] border border-dashed px-1 text-accent" style={{ borderColor: "var(--accent)" }}>
              draft
            </span>
            <span className="mono text-muted">{draft.branch}</span>
          </span>
          <span className="mono text-muted">no consumers yet</span>
          <span />
          <StateChip state="added" />
        </div>
      ))}
    </>
  );
}

/** Events a shown draft adds to a service, as rows in the service page's list. */
export function DraftServiceEventRows({ serviceId }: { serviceId: string }) {
  const added = useAddedEntities().filter(({ entity }) => entity.kind === "event" && entity.parent?.startsWith(`${serviceId}.`));
  return (
    <>
      {added.map(({ draft, entity }) => (
        <div key={`${draft.branch}:${entity.id}`} className="row gap-2 border border-dashed border-accent/40">
          <KindIcon kind="event" />
          <Link to={paths.draftEntity(draft.project, draft.branch, entity.id)} className="mono rounded-control italic" style={{ color: "var(--kind-event)" }}>
            {entity.name}
          </Link>
          <span className="mono flex items-center gap-2 text-muted">
            {entity.parent?.split(".").pop()}
            <StateChip state="added" />
            <span className="text-accent">{draft.branch}</span>
          </span>
          <span className="mono text-muted">no consumers yet</span>
          <span />
        </div>
      ))}
    </>
  );
}

const GLYPH = { added: "+", changed: "~", grown: "~", conflict: "!", removed: "−" } as const;
const GLYPH_COLOR = {
  added: "var(--status-verified)",
  changed: "var(--accent)",
  grown: "var(--status-declared)",
  conflict: "var(--status-unresolved)",
  removed: "var(--fg-muted)",
} as const;

/** A compact mark for a tree row: one glyph per shown draft that touched it. */
export function DraftTreeMark({ id }: { id: string }) {
  const touching = useDraftsTouching(id);
  if (touching.length === 0) return null;
  return (
    <span className="mono flex shrink-0 items-center gap-0.5 text-[11px]" aria-label={touching.map(({ draft, entity }) => `${entity.state} in ${draft.branch}`).join(", ")}>
      {touching.map(({ draft, entity }) => (
        <span key={draft.branch} style={{ color: GLYPH_COLOR[entity.state] }} title={`${entity.state} in ${draft.branch}`}>
          {GLYPH[entity.state]}
        </span>
      ))}
    </span>
  );
}

/** For the palette: what shown drafts did to things main has, as a badge by id. */
export function useDraftBadges(): ReadonlyMap<string, string> {
  const drafts = useEnabledDrafts();
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const draft of drafts) {
      for (const entity of draft.entities) {
        if (entity.state === "added") continue;
        const text = `${entity.state} in ${draft.branch}`;
        out.set(entity.id, out.has(entity.id) ? `${out.get(entity.id)} · ${text}` : text);
      }
    }
    return out;
  }, [drafts]);
}
