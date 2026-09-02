// Where a call and the interface it names disagree.
//
// docs/adr/org.0001.md promises this: producers publish their schema, consumers
// keep a narrowed copy, and "a field, method or enum value that differs between
// the two is reported against the consuming service". This is the first half of
// that promise - a call naming a method no provider declares.
//
// It is deliberately NOT done in the merge. src/merge.ts is documented as
// union-by-id plus first-non-empty and nothing else, and teaching it to compare
// shapes would put a semantic judgement in the one place that has none. The
// comparison belongs here, over the merged catalog, on the page where the rest
// of that judgement already lives.
//
// This is also NOT the same finding as derive.ts's `rpc` problem. That one is
// about the PEER: a call whose other end is nobody the catalog knows. This one
// is about a call whose peer is known and whose METHOD is not - the copy is
// stale, or the producer removed something, and the two are different repairs.

import type { Catalog, CatalogIndex } from "../catalog";
import type { Problem } from "./derive";

/**
 * Every call that names a method no interface in the catalog declares.
 *
 * An unresolved call is skipped: it already has a problem of its own from
 * `problems()`, and reporting the same edge twice under two headings would make
 * the page look worse than the estate is.
 */
export function protoProblems(
  catalog: Catalog,
  index: CatalogIndex,
): Problem[] {
  const out: Problem[] = [];

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const call of service.consumes) {
        if (call.status === "unresolved") continue;

        // The peer has to be a service in the catalog before the method is
        // worth asking about. A call to something outside the estate is a fact,
        // not a defect.
        if (!index.serviceById.has(call.peer)) continue;

        if (index.rpcProviderByMethod.has(call.id)) continue;

        out.push({
          kind: "proto-missing",
          // An error, not a staleness warning: the peer is in the catalog and
          // does not answer on this. Either the copy is behind or the method is
          // gone, and both are a call that will fail.
          severity: "error",
          context: context.id,
          service: service.id,
          id: call.id,
          peer: call.peer,
          note: call.note,
          source: call.source,
        });
      }
    }
  }

  return out;
}
