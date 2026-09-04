// The inverse of ids.ts.
//
// Going out, a catalog id becomes a LikeC4 identifier by replacing whatever
// LikeC4 will not accept. Coming back — from a clicked node to the thing it
// stands for — that substitution has to be undone, and the only honest way to
// undo it is to remember which catalog id produced which identifier.

import { catalog } from "../data";
import { fqn } from "./ids";

const toCatalogId = new Map<string, string>();

function remember(id: string): void {
  const likec4 = fqn(id);
  // First writer wins: two catalog ids that collapse to one identifier would
  // be a modelling bug, and silently reassigning would hide it.
  if (!toCatalogId.has(likec4)) toCatalogId.set(likec4, id);
}

for (const context of catalog.contexts) {
  remember(context.id);
  for (const service of context.services) {
    remember(service.id);
    for (const aggregate of service.aggregates) {
      remember(aggregate.id);
      for (const event of aggregate.events) remember(event.id);
    }
  }
}
// A store is a container inside the service that owns it, and clicking one
// should open the schema rather than nothing.
for (const store of catalog.stores ?? []) remember(store.id);
// Brokers, actors and externals are model elements too, and a flow lane is the
// most likely thing on screen to be clicked.
for (const flow of catalog.flows) {
  for (const participant of flow.participants) remember(participant.id);
}

/**
 * The catalog id a LikeC4 element id stands for, or the id unchanged when the
 * model holds something the catalog does not — an external participant, say.
 */
export function catalogIdOf(likec4Id: string): string {
  return toCatalogId.get(likec4Id) ?? likec4Id;
}

/** Every LikeC4 element id the catalog can produce. */
export function knownLikeC4Ids(): string[] {
  return [...toCatalogId.keys()];
}
