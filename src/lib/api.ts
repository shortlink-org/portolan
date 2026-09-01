// The two halves of an interface, joined.
//
// An operation says which methods expose it, by name; an interface says which
// methods it declares. Neither half knows the other, because they are read out
// of different files by different generators - the handlers say what runs, the
// document says what is offered - and they meet here, after the merge, which is
// the first place both are present.

import type { Aggregate, Operation, RpcService, Service } from "../catalog";

/**
 * The interface that declares a method. Undefined when nothing this service
 * offers carries that name, which the validator refuses in a catalog and is
 * therefore a shape callers may ignore rather than one they must handle.
 */
export function interfaceDeclaring(
  service: Service,
  method: string,
): RpcService | undefined {
  return service.provides.find((provided) => provided.methods.includes(method));
}

/** The interface method, written the way the rest of the app writes one. */
export function methodId(service: Service, method: string): string {
  const declaring = interfaceDeclaring(service, method);

  return declaring ? `${declaring.id}/${method}` : method;
}

export interface ExposedOperation {
  aggregate: Aggregate;
  operation: Operation;
}

/**
 * What a method actually runs, across every aggregate of the service.
 *
 * More than one is normal rather than a mistake: an endpoint that resolves a
 * token before changing a password has run two use cases, and a page that
 * showed only the second would be describing half of what happened.
 */
export function operationsExposedBy(
  service: Service,
  method: string,
): ExposedOperation[] {
  const out: ExposedOperation[] = [];

  for (const aggregate of service.aggregates) {
    for (const operation of aggregate.operations) {
      if (operation.exposedBy?.includes(method)) {
        out.push({ aggregate, operation });
      }
    }
  }

  return out;
}

/**
 * Operations nothing outside the service can reach.
 *
 * Not a defect on its own: a use case run by a policy rather than by a caller
 * is unreachable on purpose, and so is one deliberately left off the API. It
 * is worth being able to ask the question.
 */
export function unexposed(service: Service): ExposedOperation[] {
  const out: ExposedOperation[] = [];

  for (const aggregate of service.aggregates) {
    for (const operation of aggregate.operations) {
      if (!operation.exposedBy?.length) out.push({ aggregate, operation });
    }
  }

  return out;
}
