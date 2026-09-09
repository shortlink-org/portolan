import type { Step } from "../catalog";

/** The message a reader sees everywhere a flow step is listed or drawn. */
export function stepLabel(step: Step): string {
  const access = step.storeAccess;
  if (access?.operation && access.keyspace) {
    return `${access.operation.toUpperCase()} ${access.keyspace}`;
  }
  return step.label ?? step.ref ?? step.kind;
}
