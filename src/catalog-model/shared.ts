// Shared primitives every family of the model is built from: the status a
// claim carries, the field shape messages and blocks are made of, and the
// records that say where a derived fact was read from.

export type Status = "verified" | "declared" | "unresolved";

/** Every status, best first: the order a count or a filter lists them in. */
export const STATUSES: readonly Status[] = [
  "verified",
  "declared",
  "unresolved",
];

export interface Field {
  name: string;
  type: string;
  doc: string;
  /** Still on the wire, but not to be written or read anew: a `@deprecated` on the field. */
  deprecated?: boolean;
  ref?: string;
  /** Protobuf field number; absent for sources whose wire has no field numbers. */
  number?: number;
  /**
   * The source says the field must be sent: a Protovalidate `required`, a
   * name in a JSON Schema `required` list. Absent means the source does not
   * say, which in proto3 and OpenAPI alike means it may be left out.
   */
  required?: boolean;
  /** What the source says a value must satisfy, in the order it said it. */
  rules?: FieldRule[];
  /**
   * The protobuf oneof the field belongs to. Fields of one message with the
   * same name here are alternatives: at most one of them is set on the wire.
   */
  oneof?: string;
} // ref -> defs key
/**
 * One constraint on a field's value, in the catalog's own vocabulary so a
 * Protovalidate `min_len` and a JSON Schema `minLength` are one rule:
 * `min_len`, `max_len`, `len`, `pattern`, `prefix`, `suffix`, `contains`,
 * `not_contains`, `format`, `gt`, `gte`, `lt`, `lte`, `const`, `in`,
 * `not_in`, `multiple_of`, `min_items`, `max_items`, `unique`, `min_pairs`,
 * `max_pairs`, `defined_only`, `lt_now`, `gt_now`, `cel`. A rule on what a
 * list holds is prefixed `items.`; on a map's keys or values, `keys.` or
 * `values.`. A custom option the catalog has no word for keeps the name the
 * source gave it, `(acme.pii)`, so it is shown rather than lost.
 */
export interface FieldRule {
  name: string;
  /** The bound as the source wrote it, text so a 64-bit number survives; absent for a bare flag such as `unique`. */
  value?: string;
}
export interface TypeDef {
  fields: Field[];
}

/**
 * Where a derived edge was read from: the flow step that implies it. A
 * consumer or a call carrying `via` was not declared by any source; it is
 * what a flow already said, written where the graph can read it. It is kept
 * as a field rather than a note because the UI links back to the step.
 */
export interface EdgeVia {
  flow: string; // Flow.slug
  step: string; // Step.id
}

/** Source facts used to derive a relationship; not a runtime trace. */
export interface RelationEvidence {
  kind: "call-site" | "function" | "binding" | "contract" | "resolution" | "unresolved";
  rule: string;
  source?: string;
  symbol?: string;
  candidates?: string[];
}
