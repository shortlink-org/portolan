// Which document a service's interfaces were read out of, and what can be
// drawn from it.
//
// `ApiReference` states the rule this module serves: the source document is
// drawn because the catalog cannot carry the document's own shape, and
// re-deriving that into the schema would be rebuilding OpenAPI inside it.
//
// For a proto that premise is false. The extractor reads exactly that shape -
// services, methods, the two messages each one moves - so the catalog already
// holds it, structured and linkable. Drawing the raw text would be showing a
// worse copy of data we have: a `<pre>` cannot link a field to the shared type
// it refs, or a method to the operation it exposes.

import type { Service } from "../catalog";

/**
 * The path part of a source reference.
 *
 * A proto source carries the line the declaration sits on -
 * `proto/shop/v1/orders.proto:12` - and an OpenAPI one does not, which is why
 * `hasSpec` never had to care. Checking the extension against the raw string
 * would classify every proto as unknown.
 */
export function docPathOf(source: string): string {
  return source.replace(/:\d+$/, "");
}

/** The line a declaration sits on, when the source names one. */
export function sourceLineOf(source: string): number | null {
  const at = /:(\d+)$/.exec(source);

  return at?.[1] ? Number(at[1]) : null;
}

export type SourceDocKind = "openapi" | "proto" | null;

export function sourceDocKind(source: string): SourceDocKind {
  const path = docPathOf(source).toLowerCase();
  if (path.endsWith(".proto")) return "proto";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "openapi";

  return null;
}

/** What the spec tab should draw. */
export type SpecChoice =
  { kind: "openapi"; source: string } | { kind: "module"; moduleId: string };

/**
 * The document to show for a service.
 *
 * Precedence: an OpenAPI document this repository actually holds, then the
 * module its interfaces came from. Predicates are injected so the globs stay in
 * the component layer and this stays testable without a bundler.
 */
export function pickSpec(
  service: Service,
  hasOpenApi: (source: string) => boolean,
): SpecChoice | null {
  for (const provided of service.provides) {
    if (hasOpenApi(provided.source)) {
      return { kind: "openapi", source: provided.source };
    }
  }

  for (const provided of service.provides) {
    if (provided.module) return { kind: "module", moduleId: provided.module };
  }

  return null;
}
