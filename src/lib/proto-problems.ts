// Where a call and the interface it names disagree.
//
// docs/adr/org.0001.md promises this: producers publish their schema, consumers
// keep a narrowed copy, and "a field, method or enum value that differs between
// the two is reported against the consuming service". The extractor retains
// those copies on the consumer; this reader compares them after every source
// has met in the merged catalog.
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

import type {
  Catalog,
  CatalogIndex,
  RpcEnum,
  RpcMessage,
  RpcMethod,
  RpcService,
  Service,
} from "../catalog";
import type { Problem } from "./derive";

/**
 * Every missing method and every retained consumer descriptor that disagrees
 * with the provider's method, field, or enum value.
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

      for (const copy of service.copies ?? []) {
        const drift = driftAgainstProvider(service, copy, index);
        if (drift) out.push(drift);
      }
    }
  }

  return out;
}

/** Compare one consumer copy only when one of its calls resolves to a provider. */
function driftAgainstProvider(
  consumer: Service,
  copy: RpcService,
  index: CatalogIndex,
): Problem | undefined {
  const calls = new Map(
    consumer.consumes
      .filter((call) => call.id.startsWith(`${copy.id}/`))
      .map((call) => [call.id, call]),
  );
  const resolved = copy.methods
    .map((method) => calls.get(`${copy.id}/${method.name}`))
    .find(
      (call) =>
        call?.status !== "unresolved" && index.serviceById.has(call?.peer ?? ""),
    );
  if (!resolved) return undefined;

  const providerService = index.serviceById.get(resolved.peer);
  const provider = providerService?.provides.find(
    (candidate) => candidate.id === copy.id,
  );
  if (!providerService || !provider) return undefined;

  const differences = compareInterfaces(copy, provider);
  if (differences.length === 0) return undefined;

  return {
    kind: "proto-drift",
    severity: "warning",
    context: index.serviceContext.get(consumer.id)?.id ?? "",
    service: consumer.id,
    id: copy.id,
    peer: providerService.id,
    note: `Vendored copy differs from ${providerService.id}: ${differences.join("; ")}.`,
    source: copy.source,
  };
}

function compareInterfaces(copy: RpcService, provider: RpcService): string[] {
  const out: string[] = [];
  const methods = new Map(provider.methods.map((method) => [method.name, method]));

  for (const method of copy.methods) {
    const actual = methods.get(method.name);
    // A missing method already has the stronger proto-missing error.
    if (!actual) continue;
    compareMethod(method, actual, out);
  }

  const messages = new Map(
    (provider.messages ?? []).map((message) => [message.name, message]),
  );
  for (const message of copy.messages ?? []) {
    compareMessage(message, messages.get(message.name), out);
  }

  const enums = new Map(
    (provider.enums ?? []).map((item) => [item.name, item]),
  );
  for (const item of copy.enums ?? []) {
    compareEnum(item, enums.get(item.name), out);
  }

  return out;
}

function compareMethod(
  copy: RpcMethod,
  provider: RpcMethod,
  out: string[],
): void {
  for (const side of ["request", "response"] as const) {
    if (copy[side] !== provider[side]) {
      out.push(
        `${copy.name} ${side} is ${copy[side] || "unnamed"}, provider has ${provider[side] || "unnamed"}`,
      );
    }
  }
  if (copy.streaming !== provider.streaming) {
    out.push(
      `${copy.name} streaming is ${copy.streaming ?? "unary"}, provider has ${provider.streaming ?? "unary"}`,
    );
  }
}

/**
 * A narrowed copy may omit provider fields it does not read. Every field it
 * does carry must still have the provider's type and protobuf number.
 */
function compareMessage(
  copy: RpcMessage,
  provider: RpcMessage | undefined,
  out: string[],
): void {
  if (!provider) {
    out.push(`message ${copy.name} is absent from the provider`);
    return;
  }

  const fields = new Map(provider.fields.map((field) => [field.name, field]));
  for (const field of copy.fields) {
    const actual = fields.get(field.name);
    if (!actual) {
      out.push(`${copy.name}.${field.name} is absent from the provider`);
      continue;
    }
    if (field.type !== actual.type) {
      out.push(
        `${copy.name}.${field.name} is ${field.type}, provider has ${actual.type}`,
      );
    }
    if (
      field.number !== undefined &&
      actual.number !== undefined &&
      field.number !== actual.number
    ) {
      out.push(
        `${copy.name}.${field.name} is field ${field.number}, provider has ${actual.number}`,
      );
    }
  }
}

/** Enum names and numbers are both wire claims, so the sets must match whole. */
function compareEnum(
  copy: RpcEnum,
  provider: RpcEnum | undefined,
  out: string[],
): void {
  if (!provider) {
    out.push(`enum ${copy.name} is absent from the provider`);
    return;
  }

  const copyByName = new Map(copy.values.map((value) => [value.name, value]));
  const providerByName = new Map(
    provider.values.map((value) => [value.name, value]),
  );
  for (const value of copy.values) {
    const actual = providerByName.get(value.name);
    if (!actual) {
      out.push(`${copy.name}.${value.name} is absent from the provider`);
    } else if (value.number !== actual.number) {
      out.push(
        `${copy.name}.${value.name} is ${value.number}, provider has ${actual.number}`,
      );
    }
  }
  for (const value of provider.values) {
    if (!copyByName.has(value.name)) {
      out.push(`${copy.name}.${value.name} is missing from the copy`);
    }
  }
}
