// Branch drafts for the UI tests, made the way `portolan dev` makes them:
// two catalogs of the frozen estate - the base and the branch - compared by
// `diffBranch`, and presented against a main that may have moved on since.
// A test says what the branch and main each did to the estate; the states the
// pages show follow from that, not from a draft typed by hand.

import type { Catalog, Event, Flow, Step } from "../catalog";
import { walkSteps } from "../catalog";
import { presentDraft } from "../drafts/model";
import type { Draft, DraftHealth } from "../drafts/model";
import { DRAFT_SCHEMA, diffBranch, mainEntities } from "../lib/branch-draft";
import type { BranchDraft } from "../lib/branch-draft";
import { catalog } from "./estate";

export type Edit = (catalog: Catalog) => void;

/** The estate with the edits applied, the estate itself untouched. */
export function estateWith(...edits: Edit[]): Catalog {
  const copy = structuredClone(catalog);
  for (const edit of edits) edit(copy);
  return copy;
}

export function flowIn(estate: Catalog, id: string): Flow {
  const flow = estate.flows.find((candidate) => candidate.id === id);
  if (!flow) throw new Error(`no flow ${id} in the estate`);
  return flow;
}

export function eventIn(estate: Catalog, id: string): Event {
  for (const context of estate.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        const event = aggregate.events.find((candidate) => candidate.id === id);
        if (event) return event;
      }
    }
  }
  throw new Error(`no event ${id} in the estate`);
}

function stepIn(flow: Flow, id: string): Step {
  const step = walkSteps(flow.steps).find((candidate) => candidate.id === id);
  if (!step) throw new Error(`no step ${id} in ${flow.id}`);
  return step;
}

/** Gives one step of a flow another label: the smallest change a flow can have. */
export const relabelStep = (flowId: string, stepId: string, label: string): Edit => (estate) => {
  stepIn(flowIn(estate, flowId), stepId).label = label;
};

/** Adds a field to the latest version of an event. */
export const addField = (eventId: string, name: string, type = "string"): Edit => (estate) => {
  eventIn(estate, eventId).versions.at(-1)!.fields.push({ name, type, doc: "" });
};

export const LOGIN = "flow.auth-login";
export const SESSION_STARTED = "auth.auth.session.SessionStarted";

/** A saved draft of the estate: what the edits did from the base. */
export function savedDraft(branch: string, edits: Edit[], { project = "auth", base = catalog }: { project?: string; base?: Catalog } = {}): BranchDraft {
  return {
    schema: DRAFT_SCHEMA,
    project,
    branch,
    tip: `${branch.replace(/[^a-z]/g, "").padEnd(7, "0").slice(0, 7)}aaaaaaaa`,
    base: "b45e000000000000",
    generatedAt: "2026-09-15T10:00:00Z",
    entities: diffBranch(base, estateWith(...edits)),
  };
}

/** The draft as the pages read it, against the main the site is built from. */
export function shownDraft(file: BranchDraft, { main = catalog, health }: { main?: Catalog; health?: DraftHealth } = {}): Draft {
  return presentDraft(file, {
    main: mainEntities(main),
    hrefOf: (kind, id) => (kind === "flow" ? `/flows/${id.replace(/^flow\./, "")}` : `/entity/${id}`),
    contextOf: (serviceId) => serviceId.split(".")[0],
    knownParticipants: new Set(main.flows.flatMap((flow) => flow.participants.map((participant) => participant.id))),
    projectName: "Authentication",
    ...(health ? { health } : {}),
  });
}
