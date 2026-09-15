// Events, aggregates and services as a branch has them, in the catalog's own
// shape, with what differs from main said per field and per operation - so
// the site's own pages render the branch and mark the change.

import type { Aggregate, Event, Field, Operation, Service } from "../catalog";
import type { IntegrationGroup } from "../lib/integrations";
import type { DraftEntity } from "./model";

export type FieldChangeMark = { change: "new" | "changed" | "removed"; from?: string };

/** The branch's fields against main's: a mark per field it added or retyped, and the fields it dropped. */
export function compareFields(main: readonly Field[], branch: readonly Field[]): { marks: Map<string, FieldChangeMark>; removed: Field[] } {
  const before = new Map(main.map((field) => [field.name, field]));
  const after = new Set(branch.map((field) => field.name));
  const marks = new Map<string, FieldChangeMark>();
  for (const field of branch) {
    const was = before.get(field.name);
    if (!was) marks.set(field.name, { change: "new" });
    else if (was.type !== field.type) marks.set(field.name, { change: "changed", from: was.type });
  }
  return { marks, removed: main.filter((field) => !after.has(field.name)) };
}

/** An event as the branch has it, its latest version's fields marked against main's. */
export function branchEvent(main: Event, entity: DraftEntity) {
  const branch = entity.versions.branch as Event | undefined;
  if (!branch) return null;
  const event: Event = structuredClone(branch);
  const compared = compareFields(main.versions.at(-1)?.fields ?? [], event.versions.at(-1)?.fields ?? []);
  return { event, marks: compared.marks, removed: compared.removed };
}

/** An event only a branch has, as the branch's catalog holds it. */
export function addedEvent(entity: DraftEntity): Event | null {
  return (entity.versions.branch as Event | undefined) ?? null;
}

export type OperationMark = "added" | "removed";

/**
 * An aggregate with the branch's operations and root. A draft keeps an
 * aggregate without its events, which are entities of their own, so the
 * events are main's; an operation the branch dropped stays listed, marked.
 */
export function branchAggregate(main: Aggregate, entity: DraftEntity) {
  const branch = entity.versions.branch as Omit<Aggregate, "events"> | undefined;
  if (!branch) return null;
  const aggregate: Aggregate = { ...structuredClone(branch), events: main.events } as Aggregate;
  const operationMarks = new Map<string, OperationMark>();
  const kept = new Set(aggregate.operations.map((op) => op.id));
  for (const op of aggregate.operations) if (!main.operations.some((candidate) => candidate.id === op.id)) operationMarks.set(op.id, "added");
  for (const op of main.operations) {
    if (kept.has(op.id)) continue;
    aggregate.operations.push(structuredClone(op) as Operation);
    operationMarks.set(op.id, "removed");
  }
  const rootOf = (candidate: Pick<Aggregate, "name" | "entities">) => candidate.entities.find((block) => block.name === candidate.name) ?? candidate.entities[0];
  const [rootBefore, rootAfter] = [rootOf(main), rootOf(aggregate)];
  let rootFields: { added: number; removed: number } | null = null;
  if (rootBefore && rootAfter) {
    const compared = compareFields(rootBefore.fields ?? [], rootAfter.fields ?? []);
    const added = [...compared.marks.values()].filter((mark) => mark.change === "new").length;
    if (added || compared.removed.length) rootFields = { added, removed: compared.removed.length };
  }
  return { aggregate, operationMarks, rootFields, rootName: rootAfter?.name };
}

/** The systems a branch's service calls that no flow on main draws, as integration groups. */
export function draftIntegrationGroups(service: Service, entity: DraftEntity, branch: string): IntegrationGroup[] {
  return (entity.newParticipants ?? [])
    .filter((participant) => participant.from === service.id)
    .map((participant) => ({
      id: `draft:${participant.id}`,
      name: `${participant.label} · new in ${branch}`,
      kind: "external" as const,
      operations: [
        {
          call: {
            id: `${participant.id}/${participant.via}`,
            peer: participant.id,
            status: "declared" as const,
            source: "",
            note: "added in this branch; no contract for it is in the catalog yet",
          },
          protocol: "RPC" as const,
        },
      ],
      documented: 1,
      protocols: ["RPC" as const],
    }));
}
