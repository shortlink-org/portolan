// Small, executable examples for a gRPC method.
//
// The protobuf extractor already leaves the catalog with enough information
// to sketch a request. Keeping that derivation here means the reference UI
// does not need to understand scalar mappings, recursive messages or shell
// quoting, and it gives the generated command a focused test surface.

import type { Field, RpcMethod, RpcService, TypeDef } from "../catalog";
import { parseType } from "./shape";

const NUMBER = new Set([
  "double",
  "float",
  "int32",
  "sint32",
  "sfixed32",
  "uint32",
  "fixed32",
]);
const LONG = new Set([
  "int64",
  "sint64",
  "sfixed64",
  "uint64",
  "fixed64",
]);

function shortName(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function fieldsFor(
  provided: RpcService,
  name: string,
  ref: string | undefined,
  defs: Record<string, TypeDef>,
): Field[] | null {
  if (ref && defs[ref]) return defs[ref].fields;
  const bare = shortName(name);
  return (
    provided.messages?.find(
      (message) => message.name === name || message.name === bare,
    )?.fields ?? null
  );
}

function valueFor(
  provided: RpcService,
  field: Field,
  defs: Record<string, TypeDef>,
  visiting: ReadonlySet<string>,
): unknown {
  const parsed = parseType(field.type);
  if (parsed.cardinality === "many") return [];
  if (parsed.cardinality === "map") return {};

  const type = shortName(parsed.base);
  if (type === "string" || type === "bytes") return "";
  if (type === "bool") return false;
  if (NUMBER.has(type)) return 0;
  // ProtoJSON writes 64-bit integers as decimal strings so their precision is
  // not lost in JavaScript.
  if (LONG.has(type)) return "0";
  if (type === "Timestamp") return "1970-01-01T00:00:00Z";
  if (type === "Duration") return "0s";
  if (type === "FieldMask") return "";
  if (type === "Struct") return {};
  if (type === "Value") return null;
  if (type === "ListValue") return [];
  if (type === "Empty") return {};
  if (type === "Any") return { "@type": "" };

  const set = provided.enums?.find(
    (candidate) => candidate.name === parsed.base || candidate.name === type,
  );
  if (set) return set.values[0]?.name ?? "";

  const nested = fieldsFor(provided, parsed.base, field.ref, defs);
  if (!nested || visiting.has(parsed.base)) return {};

  const next = new Set(visiting).add(parsed.base);
  return Object.fromEntries(
    nested.map((child) => [child.name, valueFor(provided, child, defs, next)]),
  );
}

/** A valid ProtoJSON-shaped starting point for a method request. */
export function grpcRequestJson(
  provided: RpcService,
  method: RpcMethod,
  defs: Record<string, TypeDef>,
): string {
  if (!method.request) return "{}";
  const fields = fieldsFor(provided, method.request, method.requestRef, defs);
  if (!fields) return "{}";

  const visiting = new Set([method.request]);
  const value = Object.fromEntries(
    fields.map((field) => [field.name, valueFor(provided, field, defs, visiting)]),
  );
  return JSON.stringify(value, null, 2);
}

/** A copyable local-development invocation. The endpoint is deliberately visible. */
export function grpcurlCommand(
  provided: RpcService,
  method: RpcMethod,
  defs: Record<string, TypeDef>,
): string {
  const body = grpcRequestJson(provided, method, defs).replace(/'/g, `'"'"'`);
  return [
    "grpcurl -plaintext \\",
    `  -d '${body}' \\`,
    "  localhost:50051 \\",
    `  ${provided.id}/${method.name}`,
  ].join("\n");
}
