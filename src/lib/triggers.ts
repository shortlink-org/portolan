// What in a service publishes an event: the other half of `Operation.emits`
// and `Transition.emits`, read from the event's side.
//
// Both facts live on the producing aggregate - an operation says which events
// its handler can hand back, a lifecycle move says which event it announces -
// and the event page asks the reverse question. Only the publishing service is
// searched: an operation emits its own service's events, so nothing elsewhere
// can name this one.

import type { Aggregate, Operation, Service, Transition } from "../catalog";

export type Trigger =
  | { kind: "operation"; aggregate: Aggregate; operation: Operation }
  | { kind: "transition"; aggregate: Aggregate; transition: Transition };

/**
 * Operations first, then lifecycle moves, each in the order its aggregate
 * lists them. An operation and the move it makes are both listed: one is the
 * scenario a caller runs, the other the change of state it causes, and the
 * page is the place a reader sees that they are the same publication.
 */
export function triggersOf(service: Service, eventId: string): Trigger[] {
  const operations: Trigger[] = [];
  const transitions: Trigger[] = [];
  for (const aggregate of service.aggregates) {
    for (const operation of aggregate.operations) {
      if (operation.emits?.includes(eventId)) {
        operations.push({ kind: "operation", aggregate, operation });
      }
    }
    for (const transition of aggregate.lifecycle?.transitions ?? []) {
      if (transition.emits === eventId) {
        transitions.push({ kind: "transition", aggregate, transition });
      }
    }
  }
  return [...operations, ...transitions];
}
