// An example message, built from a schema rather than recorded.
//
// A reader who has the table of fields still has to picture the message:
// which fields nest, what a list holds, what an enum's value looks like on
// the wire. This writes that picture as JSON a reader can paste into a test
// or a publish command. Every value comes from what the catalog knows - the
// type, the rules, the enum's values, the shape a type names - and where
// none of those pins a value it is a placeholder, the way an OpenAPI viewer
// writes "string". Nothing here is a message anyone sent: a recorded
// payload can carry what a catalog must never hold.

import type { Catalog, Field, FieldRule } from "../catalog";
import { MAX_DEPTH, parseType, resolveShape, scopeOf } from "./shape";
import type { Scope } from "./shape";

const DATE_TIME = "2026-01-01T12:00:00Z";
const FUTURE = "2100-01-01T12:00:00Z";
const DATE = "2026-01-01";
const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

/**
 * The scalars as the extractors spell them - proto, Go, Rust, TypeScript,
 * Python, Java, Kotlin, C#, PHP, JSON Schema - folded to one kind each.
 * Looked up by the last dotted segment, lowercased: `google.protobuf.Timestamp`
 * and `time.Time` are a timestamp, `uuid.UUID` a uuid.
 */
const SCALARS: Record<string, Kind> = {
  string: "string", str: "string", text: "string", char: "string",
  "&str": "string", charsequence: "string",
  bytes: "bytes", "[]byte": "bytes", bytearray: "bytes",
  bool: "boolean", boolean: "boolean",
  int: "integer", int8: "integer", int16: "integer", int32: "integer",
  int64: "long", uint: "integer", uint8: "integer", uint16: "integer",
  uint32: "integer", uint64: "long", sint32: "integer", sint64: "long",
  fixed32: "integer", fixed64: "long", sfixed32: "integer", sfixed64: "long",
  i8: "integer", i16: "integer", i32: "integer", i64: "integer",
  u8: "integer", u16: "integer", u32: "integer", u64: "integer",
  usize: "integer", isize: "integer", integer: "integer", long: "integer",
  short: "integer", byte: "integer", bigint: "integer", biginteger: "integer",
  float: "number", double: "number", float32: "number", float64: "number",
  f32: "number", f64: "number", number: "number", decimal: "decimal",
  bigdecimal: "decimal",
  timestamp: "date-time", time: "date-time", datetime: "date-time",
  "datetime<utc>": "date-time", instant: "date-time",
  offsetdatetime: "date-time", zoneddatetime: "date-time",
  localdatetime: "date-time", datetimeoffset: "date-time",
  datetimeimmutable: "date-time", datetimeinterface: "date-time",
  carbon: "date-time", carbonimmutable: "date-time",
  date: "date-time", localdate: "date", naivedate: "date",
  duration: "duration", timedelta: "duration",
  uuid: "uuid", guid: "uuid", ulid: "string",
  any: "any", object: "object", struct: "object", value: "any",
  empty: "object", "map[string]interface{}": "object",
  "interface{}": "any", unknown: "any",
};

type Kind =
  | "string" | "bytes" | "boolean" | "integer" | "long" | "number"
  | "decimal" | "date-time" | "date" | "duration" | "uuid" | "any"
  | "object";

/** What the type names, with the extractor's decorations taken off. */
function kindOf(base: string): Kind | undefined {
  const bare = base.replace(/\s*\(.*\)$/, "").replace(/\s+enum$/, "");
  const last = bare.split(".").at(-1) ?? bare;
  return SCALARS[last.toLowerCase()] ?? SCALARS[bare.toLowerCase()];
}

/** `string (uuid)` - a format OpenAPI writes into the type. */
function formatInType(type: string): string | undefined {
  return type.match(/\((date-time|date|uuid|email|uri|url|hostname|ipv4|ipv6)\)/)?.[1];
}

/** `string enum(A | B)` - an OpenAPI enum written into the type. */
function enumInType(type: string): string[] {
  const inner = type.match(/enum\((.*)\)/)?.[1];
  return inner ? inner.split("|").map((v) => v.trim()).filter(Boolean) : [];
}

/** The rules on the value itself, not on what a list or map holds. */
function own(rules: readonly FieldRule[]): FieldRule[] {
  return rules.filter((r) => !/^(items|keys|values)\./.test(r.name));
}

/** The rules on a list's or map's members, with their prefix taken off. */
function members(rules: readonly FieldRule[], prefix: string): FieldRule[] {
  return rules
    .filter((r) => r.name.startsWith(`${prefix}.`))
    .map((r) => ({ ...r, name: r.name.slice(prefix.length + 1) }));
}

function rule(rules: readonly FieldRule[], name: string): string | undefined {
  return rules.find((r) => r.name === name)?.value;
}

/** `"EUR"` -> `EUR`: proto options keep the quotes, zod does not. */
function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/** A rule's literal as JSON would have it: a number stays a number. */
function literal(value: string, kind: Kind | undefined): unknown {
  const raw = unquote(value);
  if (kind === "integer" || kind === "number") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  if (kind === "boolean") return raw === "true";
  return raw;
}

/** A number the bounds allow, starting from a plain one. */
function bounded(rules: readonly FieldRule[], integer: boolean): number {
  const num = (name: string) => {
    const v = rule(rules, name);
    const n = v === undefined ? NaN : Number(unquote(v));
    return Number.isFinite(n) ? n : undefined;
  };
  const step = integer ? 1 : 0.5;
  let value = integer ? 1 : 1.5;
  const gte = num("gte");
  const gt = num("gt");
  const lte = num("lte");
  const lt = num("lt");
  if (gte !== undefined && value < gte) value = gte;
  if (gt !== undefined && value <= gt) value = gt + step;
  if (lte !== undefined && value > lte) value = lte;
  if (lt !== undefined && value >= lt) value = lt - step;
  const multiple = num("multiple_of");
  if (multiple) value = Math.max(multiple, Math.round(value / multiple) * multiple);
  return value;
}

/** A string the format and length rules allow. */
function text(rules: readonly FieldRule[], format: string | undefined): string {
  switch (format) {
    case "uuid":
      return UUID;
    case "email":
      return "user@example.com";
    case "uri":
    case "url":
    case "uri_ref":
      return "https://example.com";
    case "hostname":
      return "example.com";
    case "ipv4":
    case "ip":
      return "192.0.2.1";
    case "ipv6":
      return "2001:db8::1";
    case "date-time":
      return DATE_TIME;
    case "date":
      return DATE;
  }
  let value = `${unquote(rule(rules, "prefix") ?? "")}string${unquote(rule(rules, "suffix") ?? "")}`;
  const len = Number(rule(rules, "len"));
  const min = Number.isFinite(len) ? len : Number(rule(rules, "min_len"));
  const max = Number.isFinite(len) ? len : Number(rule(rules, "max_len"));
  if (Number.isFinite(min) && value.length < min) value = value.padEnd(min, "x");
  if (Number.isFinite(max) && max >= 0 && value.length > max) value = value.slice(0, max);
  return value;
}

/** How many members a list shows: one, or as many as its rules ask. */
function count(rules: readonly FieldRule[], name: string): number {
  const n = Number(rule(rules, name));
  return Number.isFinite(n) && n > 1 ? Math.min(n, 3) : 1;
}

interface Walk {
  catalog: Catalog;
  scope: Scope;
  /** Shapes already open on the path, so a cycle ends in `{}`. */
  seen: ReadonlySet<string>;
  depth: number;
}

/** One value of a type, rules applied, no list or map around it. */
function one(
  field: Field,
  base: string,
  rules: readonly FieldRule[],
  walk: Walk,
): unknown {
  const kind = kindOf(base);
  const pinned = rule(rules, "const");
  if (pinned !== undefined) return literal(pinned, kind);
  const listed = rule(rules, "in");
  if (listed !== undefined) {
    const first = listed.split(",")[0];
    if (first !== undefined && first.trim() !== "") return literal(first, kind);
  }
  const written = enumInType(field.type);
  if (written[0] !== undefined) return literal(written[0], kind);

  if (kind === undefined) {
    const shape = resolveShape(walk.catalog, { ...field, type: base }, walk.scope);
    if (!shape) return `<${base}>`;
    if (shape.kind === "enum") {
      // proto's zero value is a name nobody means to send.
      const meant = shape.values.find((v) => !/(^|_)UNSPECIFIED$|^UNKNOWN$/i.test(v.name));
      return (meant ?? shape.values[0])?.name ?? `<${base}>`;
    }
    if (walk.seen.has(shape.id) || walk.depth >= MAX_DEPTH) return {};
    return fieldsExample(shape.fields, {
      catalog: walk.catalog,
      scope: scopeOf(shape, walk.scope),
      seen: new Set([...walk.seen, shape.id]),
      depth: walk.depth + 1,
    });
  }

  const format = rule(rules, "format") ?? formatInType(field.type);
  switch (kind) {
    case "string":
      return text(rules, format);
    case "uuid":
      return UUID;
    case "bytes":
      return "";
    case "boolean":
      return true;
    case "integer":
      return bounded(rules, true);
    // ProtoJSON writes a 64-bit integer as a string, so its digits survive
    // a JavaScript reader. A field number is what says the schema is proto;
    // Go's int64 in a JSON struct is a plain number.
    case "long":
      return field.number !== undefined
        ? String(bounded(rules, true))
        : bounded(rules, true);
    case "number":
      return bounded(rules, false);
    // Written as text by every serializer that keeps a decimal exact.
    case "decimal":
      return String(bounded(rules, false));
    case "date-time":
      return rules.some((r) => r.name === "gt_now") ? FUTURE : DATE_TIME;
    case "date":
      return DATE;
    case "duration":
      return "1s";
    case "object":
      return {};
    case "any":
      return null;
  }
}

function valueOf(field: Field, walk: Walk): unknown {
  const { base, cardinality } = parseType(field.type);
  const rules = field.rules ?? [];
  if (cardinality === "many") {
    const item = one(field, base, members(rules, "items"), walk);
    return Array.from({ length: count(rules, "min_items") }, () => item);
  }
  if (cardinality === "map") {
    return { key: one(field, base, members(rules, "values"), walk) };
  }
  return one(field, base, own(rules), walk);
}

function fieldsExample(fields: readonly Field[], walk: Walk): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, valueOf(field, walk)]));
}

/**
 * An example of a message with these fields, as a JSON value: every field
 * present, nested shapes opened as far as the catalog has them, lists with
 * one member unless a rule asks for more. Field names are the schema's own.
 */
export function exampleOf(
  catalog: Catalog,
  fields: readonly Field[],
  scope: Scope,
): Record<string, unknown> {
  return fieldsExample(fields, { catalog, scope, seen: new Set(), depth: 0 });
}
