// The saved branch drafts, which of them the reader has laid over the
// catalog, and - under `portolan dev` - making, saving and deleting them
// (portolan.0019).
//
// A published site has the drafts it was built with and nothing else. The dev
// server has the same ones on load and asks the local API again whenever a
// draft is generated, saved or deleted, so the page never needs a reload.

import { useMemo } from "react";
import { useLocation } from "react-router";
import { create } from "zustand";
import saved from "virtual:portolan-drafts";
import { catalog, index } from "../data";
import { mainEntities } from "../lib/branch-draft";
import type { BranchDraft } from "../lib/branch-draft";
import {
  deleteBranchDraft,
  discardBranchDraft,
  draftBranches,
  generateBranchDraft,
  pendingBranchDraft,
  restoreBranchDraft,
  saveBranchDraft,
  savedDrafts,
  subscribeToRun,
} from "../lib/local-api";
import type { DraftBranches, SavedDraftStatus } from "../lib/local-api";
import { setupInfo } from "../lib/setup-info";
import { paths } from "../routes";
import { draftKey, healthFrom, presentDraft } from "./model";
import type { BranchChoice, Draft, DraftEntity, DraftEntityKind } from "./model";
import { versionFrom } from "./version-param";

const ENABLED_KEY = "portolan:drafts-enabled";

export type SiteMode = "dev" | "static";

export interface GenerationStep {
  label: string;
  state: "waiting" | "running" | "done" | "failed";
}

export interface Generation {
  choice: BranchChoice;
  runId?: string;
  steps: GenerationStep[];
  result?: Draft;
  log?: string[];
  error?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A browser that refuses storage still gets a working page.
  }
}

// ---------------------------------------------------------------------------
// Presenting against this site's main

const MAIN = mainEntities(catalog);
const KNOWN_LANES = new Set(catalog.flows.flatMap((flow) => flow.participants.map((participant) => participant.id)));

function hrefOf(kind: DraftEntityKind, id: string): string | undefined {
  if (kind === "flow") {
    const flow = catalog.flows.find((candidate) => candidate.id === id);
    return flow ? paths.flow(flow.slug) : undefined;
  }
  if (kind === "service") {
    const service = index.serviceById.get(id);
    const context = index.serviceContext.get(id);
    return service && context ? paths.service(context.id, service.slug) : undefined;
  }
  if (kind === "aggregate") {
    const aggregate = index.aggregateById.get(id);
    const service = index.aggregateOwner.get(id);
    const context = service && index.serviceContext.get(service.id);
    return aggregate && service && context ? paths.aggregate(context.id, service.slug, aggregate.slug) : undefined;
  }
  const event = index.eventById.get(id);
  const owner = index.eventOwner.get(id);
  const context = owner && index.serviceContext.get(owner.service.id);
  return event && owner && context ? paths.event(context.id, owner.service.slug, owner.aggregate.slug, event.slug) : undefined;
}

let projectNames = new Map(setupInfo.projects.map((project) => [project.id, project.name]));

/**
 * Whether the catalog on screen has the draft's project at all. A catalog
 * profile that leaves the project out has no main to lay the draft over, and
 * every entity the branch changed would read as removed on main - a conflict
 * nobody made.
 */
function inCatalog(file: BranchDraft): boolean {
  const project = setupInfo.projects.find((candidate) => candidate.id === file.project);
  // `group`/`component` as a manifest spells them now, `context`/`service` as
  // an older one still may.
  const context = project?.group ?? project?.context;
  const service = project?.component ?? project?.service;
  if (context && service) return index.serviceById.has(`${context}.${service}`);
  return file.entities.some((entity) => entity.change !== "added" && MAIN.has(`${entity.kind}:${entity.id}`));
}

export function present(file: BranchDraft, status?: SavedDraftStatus): Draft {
  return presentDraft(file, {
    main: MAIN,
    hrefOf,
    contextOf: (serviceId) => index.serviceContext.get(serviceId)?.id,
    knownParticipants: KNOWN_LANES,
    projectName: projectNames.get(file.project) ?? file.project,
    health: healthFrom(status),
  });
}

// ---------------------------------------------------------------------------
// The store

interface DraftStore {
  mode: SiteMode;
  /** The drafts of projects the catalog on screen has. */
  drafts: Draft[];
  /** Saved drafts of projects this catalog leaves out. */
  outside: number;
  enabled: string[];
  toggle: (key: string) => void;
  /** Asks the dev server for the drafts on disk and what it knows about their branches. */
  refresh: () => Promise<void>;
  branches: DraftBranches | null;
  loadBranches: () => Promise<void>;
  remove: (key: string) => Promise<Draft | undefined>;
  restore: (draft: Draft) => Promise<void>;
  generation: Generation | null;
  generate: (choice: BranchChoice) => Promise<void>;
  save: () => Promise<void>;
  discard: () => Promise<void>;
}

const say = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export const useDrafts = create<DraftStore>()((set, get) => ({
  mode: import.meta.env.DEV ? "dev" : "static",
  drafts: saved.filter(inCatalog).map((file) => present(file)),
  outside: saved.filter((file) => !inCatalog(file)).length,
  enabled: read<string[]>(ENABLED_KEY, []),
  toggle: (key) => {
    const enabled = get().enabled.includes(key) ? get().enabled.filter((k) => k !== key) : [...get().enabled, key];
    write(ENABLED_KEY, enabled);
    set({ enabled });
  },
  refresh: async () => {
    if (get().mode !== "dev") return;
    const { drafts, files } = await savedDrafts();
    const status = new Map(drafts.map((draft) => [`${draft.project}:${draft.branch}`, draft]));
    set({
      drafts: files.filter(inCatalog).map((file) => present(file, status.get(draftKey(file)))),
      outside: files.filter((file) => !inCatalog(file)).length,
    });
  },
  branches: null,
  loadBranches: async () => {
    if (get().mode !== "dev") return;
    const branches = await draftBranches();
    projectNames = new Map([...projectNames, ...branches.projects.map((project) => [project.id, project.name] as const)]);
    set({ branches });
  },
  remove: async (key) => {
    const draft = get().drafts.find((d) => draftKey(d) === key);
    if (!draft) return undefined;
    await deleteBranchDraft(draft);
    const enabled = get().enabled.filter((k) => k !== key);
    write(ENABLED_KEY, enabled);
    set({ drafts: get().drafts.filter((d) => draftKey(d) !== key), enabled });
    return draft;
  },
  restore: async (draft) => {
    await restoreBranchDraft(draft);
    await get().refresh();
  },
  generation: null,
  generate: async (choice) => {
    const ref = { project: choice.project, branch: choice.branch };
    set({ generation: { choice, steps: [{ label: `merge-base main ${choice.branch}`, state: "running" }] } });
    let runId: string;
    try {
      ({ runId } = await generateBranchDraft(ref));
    } catch (cause) {
      set({ generation: { choice, steps: [{ label: `merge-base main ${choice.branch}`, state: "failed" }], log: [say(cause)], error: say(cause) } });
      return;
    }
    const log: string[] = [];
    const current = () => {
      const generation = get().generation;
      return generation && generation.choice === choice ? generation : null;
    };
    set({ generation: { ...current()!, runId } });
    subscribeToRun(
      runId,
      (event) => {
        const generation = current();
        if (!generation) return;
        if (event.type === "log") {
          log.push(event.message);
          return;
        }
        if (event.type === "draft-progress") {
          log.push(event.message);
          // The first message names the merge-base the run settled on, in
          // place of the one the page guessed; every one after it is the next
          // step, and the one before it is done.
          const steps: GenerationStep[] = event.message.startsWith("merge-base")
            ? [{ label: event.message, state: "running" }]
            : [...generation.steps.map((step) => ({ ...step, state: "done" as const })), { label: event.message, state: "running" }];
          set({ generation: { ...generation, steps } });
          return;
        }
        if (event.type === "process-finished") {
          if (event.status === "ok") {
            pendingBranchDraft(ref)
              .then((file) => {
                const latest = current();
                if (!latest) return;
                set({ generation: { ...latest, steps: latest.steps.map((step) => ({ ...step, state: "done" })), result: present(file), log } });
              })
              .catch((cause) => {
                const latest = current();
                if (latest) set({ generation: { ...latest, log: [...log, say(cause)], error: say(cause) } });
              });
          } else {
            const steps = generation.steps.map((step, i, all) => ({ ...step, state: i === all.length - 1 ? ("failed" as const) : ("done" as const) }));
            set({ generation: { ...generation, steps, log, error: event.status } });
            get().refresh().catch(() => undefined);
          }
        }
      },
      () => undefined,
    );
  },
  save: async () => {
    const generation = get().generation;
    if (!generation?.result) return;
    await saveBranchDraft(generation.choice);
    set({ generation: null });
    await get().refresh();
  },
  discard: async () => {
    const generation = get().generation;
    set({ generation: null });
    if (generation?.result) await discardBranchDraft(generation.choice);
  },
}));

/** The drafts the reader has laid over the catalog. */
export function useEnabledDrafts(): Draft[] {
  const drafts = useDrafts((s) => s.drafts);
  const enabled = useDrafts((s) => s.enabled);
  // The same array until the drafts or the ticks change, so a page can key a
  // memo on it.
  return useMemo(() => drafts.filter((draft) => enabled.includes(draftKey(draft))), [drafts, enabled]);
}

/** Every enabled draft that touches one entity, with what it did to it. */
export function useDraftsTouching(id: string): { draft: Draft; entity: DraftEntity }[] {
  const drafts = useEnabledDrafts();
  return useMemo(
    () => drafts.flatMap((draft) => draft.entities.filter((entity) => entity.id === id).map((entity) => ({ draft, entity }))),
    [drafts, id],
  );
}

/**
 * The branch version on screen for an entity, when the address names one that
 * touches it. A branch that does not is main: a link to a page about something
 * else must not carry a version over to it.
 */
export function usePickedDraft(id: string): { draft: Draft; entity: DraftEntity } | undefined {
  const touching = useDraftsTouching(id);
  const version = versionFrom(useLocation().search);
  return touching.find(({ draft }) => draft.branch === version);
}

export function counts(draft: Draft): Record<DraftEntity["state"], number> {
  const out = { added: 0, changed: 0, conflict: 0, removed: 0 };
  for (const entity of draft.entities) out[entity.state] += 1;
  return out;
}

/** Every entity a shown draft adds, with its draft. */
export function useAddedEntities(): { draft: Draft; entity: DraftEntity }[] {
  const drafts = useEnabledDrafts();
  return useMemo(
    () => drafts.flatMap((draft) => draft.entities.filter((e) => e.state === "added").map((entity) => ({ draft, entity }))),
    [drafts],
  );
}
