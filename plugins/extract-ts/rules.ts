// What a zod schema says a value must satisfy, in the catalog's words.
//
// A TypeScript service states its rules where it parses: `z.string().min(1)`,
// `z.number().int().max(99)`, `z.string().uuid()`. The catalog has one
// vocabulary for these across every source (portolan.0015), so zod's `.min`
// on a string is `min_len` here as `minLength` is in an OpenAPI document and
// `min_len` in a proto, and the page says all three the same way.
//
// zod is also the only place a TypeScript service says a field must be sent:
// a schema requires every key it names unless the field is `.optional()`,
// `.nullish()`, given a `.default(…)` or the object was made `.partial()`.
// `.nullable()` is not one of them - the key must still be there, and null is
// a value it may hold.
//
// A schema is followed by name: `const body = z.object({…})` and
// `body.extend({…})` are read through `Source.consts`, across a module
// boundary when the schemas live in a file of their own. The base of the
// chain must be the module's own import of zod, so a `JSON.parse` or a
// hand-written `parse` is not mistaken for one.
//
// One level deep: the fields of the schema the handler parses, and what each
// of them must satisfy. A nested `z.object({…})` is a field of type `object`
// whose own fields are its shape's business, and a field given another schema
// by name is that schema's name - the rules inside it are read where that
// schema is parsed, not here.

import type { Field, FieldRule } from "../../src/catalog.ts";
import { isArray, isCall, isIdent, isMember, isObject, isProp, isString, keyName, memberName, text as textOf, unwrap, type Node } from "./ast.ts";
import { readSource, type Source } from "./source.ts";

/** One `.name(args)` on the chain, in the order it was written. */
interface Step {
  name: string;
  args: Node[];
}

/** A chain rooted at zod: where it was written, and every call along it. */
interface Chain {
  src: Source;
  steps: Step[];
}

/** What one expression says about a value: its type, its rules, and whether it must be there. */
interface Spec {
  type: string;
  rules: FieldRule[];
  /** The `.describe(…)` text, "" when the schema does not say. */
  doc: string;
  optional: boolean;
  /** The fields of an object schema; absent for everything else. */
  fields?: Field[];
}

/** zod's own names for a string shape, in the spelling JSON Schema and the catalog use. */
const FORMATS: Record<string, string> = {
  email: "email",
  url: "uri",
  uuid: "uuid",
  uuidv4: "uuid",
  uuidv6: "uuid",
  uuidv7: "uuid",
  guid: "uuid",
  datetime: "date-time",
  date: "date",
  time: "time",
  duration: "duration",
  ip: "ip",
  ipv4: "ipv4",
  ipv6: "ipv6",
  cidrv4: "cidrv4",
  cidrv6: "cidrv6",
  base64: "base64",
  base64url: "base64url",
  jwt: "jwt",
  emoji: "emoji",
  nanoid: "nanoid",
  cuid: "cuid",
  cuid2: "cuid2",
  ulid: "ulid",
  e164: "e164",
  hostname: "hostname",
  hex: "hex",
};

/** The primitives, by the name zod builds them under. */
const PRIMITIVES: Record<string, string> = {
  string: "string",
  number: "number",
  int: "integer",
  int32: "integer",
  int64: "integer",
  bigint: "bigint",
  boolean: "boolean",
  date: "Date",
  symbol: "symbol",
  null: "null",
  undefined: "undefined",
  void: "void",
  any: "unknown",
  unknown: "unknown",
  never: "never",
  nan: "number",
  file: "File",
};

/**
 * Calls that say how a value is carried rather than what it must be: a
 * transform, a brand, the strictness of an object, a name for a registry.
 * None of them is a rule, and a reader who meets one in the source is not
 * looking for it on the page.
 */
const CARRIED = new Set([
  "trim",
  "toLowerCase",
  "toUpperCase",
  "normalize",
  "brand",
  "readonly",
  "catch",
  "transform",
  "pipe",
  "or",
  "and",
  "strict",
  "strip",
  "passthrough",
  "meta",
  "register",
  "clone",
  "overwrite",
  "nullable",
]);

/** The fields a schema declares, or undefined when the expression is not a zod object this reader can follow. */
export function zodFields(src: Source, node: Node): Field[] | undefined {
  const spec = specOf(chainOf(src, node));
  return spec?.fields;
}

/** Whether a name is the module's own import of zod: `import { z } from "zod"`, or a namespace import of it. */
function isZod(src: Source, name: string): boolean {
  return src.imports.some((i) => i.local === name && (i.specifier === "zod" || i.specifier.startsWith("zod/")));
}

/** The const a name stands for in this module, or in the module it was imported from. */
function follow(src: Source, name: string): { src: Source; node: Node } | undefined {
  const own = src.consts.get(name);
  if (own) return { src, node: own };
  const imported = src.imports.find((i) => i.local === name && !i.typeOnly && i.file);
  if (!imported?.file) return undefined;
  const other = readSource(imported.file);
  const node = other?.consts.get(imported.imported === "*" ? name : imported.imported);
  return other && node ? { src: other, node } : undefined;
}

/**
 * The chain an expression is, from the zod import outwards: `z.string().min(1)`
 * is `string()` then `min(1)`. A name is followed to what it was given, so
 * `basketParams.extend({…})` is the chain `basketParams` was built by with
 * `extend` after it.
 */
function chainOf(src: Source, node: Node, depth = 0): Chain | undefined {
  const n = unwrap(node);
  if (isCall(n) && isMember(n.callee)) {
    const name = memberName(n.callee);
    const inner = chainOf(src, n.callee.object, depth);
    if (!name || !inner) return undefined;
    return { src: inner.src, steps: [...inner.steps, { name, args: n.arguments }] };
  }
  // `z.coerce.string()`, `z.iso.datetime()`: a namespace on the way out of
  // zod, which changes how a value is read and not what the chain is called.
  if (isMember(n) && isIdent(n.object) && isZod(src, n.object.name)) return { src, steps: [] };
  if (isIdent(n)) {
    if (isZod(src, n.name)) return { src, steps: [] };
    if (depth >= 4) return undefined;
    const target = follow(src, n.name);
    return target ? chainOf(target.src, target.node, depth + 1) : undefined;
  }
  return undefined;
}

/** What a chain says about the value it describes. */
function specOf(chain: Chain | undefined): Spec | undefined {
  if (!chain || chain.steps.length === 0) return undefined;
  const [first, ...rest] = chain.steps;
  const spec = built(chain.src, first!);
  if (!spec) return undefined;
  for (const step of rest) fold(chain.src, spec, step);
  return spec;
}

/** The constructor: what kind of value the chain starts as. */
function built(src: Source, step: Step): Spec | undefined {
  const spec = (type: string): Spec => ({ type, rules: [], doc: "", optional: false });
  const arg = step.args[0];

  if (step.name === "object" || step.name === "strictObject" || step.name === "looseObject") {
    const out = spec("object");
    out.fields = isObject(arg) ? fieldsOf(src, arg) : [];
    return out;
  }
  if (step.name === "array") {
    const inner = specOf(chainOf(src, arg!));
    if (!inner) return undefined;
    const out = spec(`${inner.type}[]`);
    out.rules = prefixed(inner.rules, "items");
    return out;
  }
  if (step.name === "record" || step.name === "map") {
    const keys = specOf(chainOf(src, step.args[0]!));
    const values = specOf(chainOf(src, step.args[1] ?? step.args[0]!));
    if (!keys || !values) return undefined;
    const out = spec(step.args.length > 1 ? `Record<${keys.type}, ${values.type}>` : `Record<string, ${keys.type}>`);
    out.rules = step.args.length > 1 ? [...prefixed(keys.rules, "keys"), ...prefixed(values.rules, "values")] : prefixed(keys.rules, "values");
    return out;
  }
  if (step.name === "enum") {
    const values = isArray(arg) ? arg.elements.map((e) => (e ? valueOf(src, e) : "")) : [];
    const out = spec("string");
    if (values.length) out.rules.push({ name: "in", value: values.join(", ") });
    return out;
  }
  if (step.name === "literal") {
    const out = spec(typeOfLiteral(arg));
    if (arg) out.rules.push({ name: "const", value: valueOf(src, arg) });
    return out;
  }
  if (step.name === "union") {
    const members = (isArray(arg) ? arg.elements : []).map((e) => (e ? specOf(chainOf(src, e)) : undefined));
    if (members.length === 0 || members.some((m) => m === undefined)) return undefined;
    const constants = members.map((m) => m!.rules.find((r) => r.name === "const")?.value);
    // A union of literals is the same fact as an enum: one of these values.
    if (constants.every((v) => v !== undefined)) {
      const out = spec(members[0]!.type);
      out.rules.push({ name: "in", value: constants.join(", ") });
      return out;
    }
    return spec([...new Set(members.map((m) => m!.type))].join(" | "));
  }

  const format = FORMATS[step.name];
  if (format) {
    const out = spec("string");
    out.rules.push({ name: "format", value: format });
    return out;
  }
  const primitive = PRIMITIVES[step.name];
  return primitive ? spec(primitive) : undefined;
}

/** One call after the constructor, as what it says about the value. */
function fold(src: Source, spec: Spec, step: Step): void {
  const arg = step.args[0];
  const value = arg ? valueOf(src, arg) : undefined;
  const list = spec.type.endsWith("[]");
  const text = spec.type === "string" || spec.type === "string[]";
  const add = (name: string, v?: string): void => {
    spec.rules.push(v === undefined ? { name } : { name, value: v });
  };

  switch (step.name) {
    case "optional":
    case "nullish":
    case "default":
    case "prefault":
      spec.optional = true;
      return;
    case "describe":
      spec.doc = value ?? spec.doc;
      return;
    case "array":
      // `z.string().array()`: what held for the value now holds for each item.
      spec.type = `${spec.type}[]`;
      spec.rules = prefixed(spec.rules, "items");
      return;
    case "partial":
      for (const field of spec.fields ?? []) delete field.required;
      return;
    case "required":
      for (const field of spec.fields ?? []) field.required = true;
      return;
    case "extend":
      if (isObject(arg)) spec.fields = merge(spec.fields ?? [], fieldsOf(src, arg));
      return;
    case "merge": {
      const other = specOf(chainOf(src, arg!));
      if (other?.fields) spec.fields = merge(spec.fields ?? [], other.fields);
      return;
    }
    case "pick":
    case "omit": {
      const named = new Set(isObject(arg) ? arg.properties.filter(isProp).map((p) => keyName(p.key) ?? "") : []);
      const keep = step.name === "pick";
      spec.fields = (spec.fields ?? []).filter((f) => named.has(f.name) === keep);
      return;
    }
    case "min":
      add(list ? "min_items" : text ? "min_len" : "gte", value);
      return;
    case "max":
      add(list ? "max_items" : text ? "max_len" : "lte", value);
      return;
    case "length":
      // A list of exactly n is the two bounds it is; `len` is the string's word.
      if (list) {
        add("min_items", value);
        add("max_items", value);
      } else add("len", value);
      return;
    case "nonempty":
      add(list ? "min_items" : "min_len", "1");
      return;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      add(step.name, value);
      return;
    case "positive":
      add("gt", "0");
      return;
    case "nonnegative":
      add("gte", "0");
      return;
    case "negative":
      add("lt", "0");
      return;
    case "nonpositive":
      add("lte", "0");
      return;
    case "multipleOf":
    case "step":
      add("multiple_of", value);
      return;
    case "int":
    case "int32":
    case "int64":
    case "safe":
      spec.type = spec.type === "number" ? "integer" : spec.type;
      return;
    case "finite":
      return;
    case "regex":
      add("pattern", arg ? patternOf(src, arg) : undefined);
      return;
    case "startsWith":
      add("prefix", value);
      return;
    case "endsWith":
      add("suffix", value);
      return;
    case "includes":
      add("contains", value);
      return;
    case "refine":
    case "superRefine":
    case "check":
      // A predicate the catalog has no words for is still a fact about the
      // field: it is named as the source names it, with its message when the
      // call gives one, rather than left for a reader to find in the file.
      add("refine", messageOf(step.args));
      return;
    default:
      if (CARRIED.has(step.name)) return;
      // An unknown shape on a string - zod grows them - is still a shape.
      if (FORMATS[step.name] && spec.type === "string") add("format", FORMATS[step.name]);
      else if (spec.type === "string") add("format", step.name);
      return;
  }
}

/** The fields of an object literal, each read as its own chain. */
function fieldsOf(src: Source, node: Node): Field[] {
  const out: Field[] = [];
  if (!isObject(node)) return out;
  for (const property of node.properties) {
    if (!isProp(property)) continue;
    const name = property.computed ? undefined : keyName(property.key);
    if (!name || !property.value) continue;
    const spec = specOf(chainOf(src, property.value));
    if (!spec) continue;
    out.push({
      name,
      type: typeNameOf(src, property.value, spec),
      doc: spec.doc,
      ...(spec.optional ? {} : { required: true }),
      ...(spec.rules.length ? { rules: spec.rules } : {}),
    });
  }
  return out;
}

/**
 * What the field's type is called: the name the schema was given when the
 * value is one - `unitPrice: money` is a `money` - and what the chain built
 * otherwise.
 */
function typeNameOf(src: Source, node: Node, spec: Spec): string {
  const n = unwrap(node);
  return isIdent(n) && !isZod(src, n.name) ? n.name : spec.type;
}

/** The later fields win, as a second `extend` of the same key does in zod. */
function merge(base: Field[], more: Field[]): Field[] {
  const out = base.filter((f) => !more.some((m) => m.name === f.name));
  return [...out, ...more];
}

function prefixed(rules: FieldRule[], of: string): FieldRule[] {
  return rules.map((r) => ({ ...r, name: `${of}.${r.name}` }));
}

/** A literal as the source wrote it: a string's text, a number without its separators. */
function valueOf(src: Source, node: Node): string {
  const n = unwrap(node);
  if (isString(n)) return n.value;
  return textOf(src.parsed, n).replace(/_/g, "").replace(/^["'`]|["'`]$/g, "");
}

/** `/^[A-Z]{3}$/i` → `^[A-Z]{3}$`: the pattern as a document or a proto would carry it, without the slashes a flag hangs off. */
function patternOf(src: Source, node: Node): string {
  const raw = textOf(src.parsed, unwrap(node));
  const m = /^\/(.*)\/[a-z]*$/s.exec(raw);
  return m ? m[1]! : raw;
}

/** The message a refinement was given, when it was given one a literal says. */
function messageOf(args: Node[]): string | undefined {
  for (const arg of args.slice(1)) {
    const n = unwrap(arg);
    if (isString(n)) return n.value;
    if (isObject(n)) {
      const message = n.properties.filter(isProp).find((p) => keyName(p.key) === "message" || keyName(p.key) === "error");
      const value = message?.value ? unwrap(message.value) : undefined;
      if (isString(value)) return value.value;
    }
  }
  return undefined;
}

function typeOfLiteral(node: Node | undefined): string {
  const n = node ? unwrap(node) : undefined;
  if (!n) return "unknown";
  if (isString(n)) return "string";
  const value = (n as { value?: unknown }).value;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}
