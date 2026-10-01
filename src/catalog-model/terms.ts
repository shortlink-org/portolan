// The ubiquitous language: one glossary term per word per context.

import type { Catalog } from "./catalog.ts";

// ---------------------------------------------------------------------------
// The ubiquitous language. One meaning per word inside a context, written down
// where the code that uses the word lives, and the leaf everything else points
// to: a term links nowhere, and nothing here is derived from the model.
//
// A word and a sentence, and nothing else. What the sentence says is the
// author's business - the one thing in this catalog that no extractor could
// have worked out from the code, and the one thing a parser has no business
// taking apart.
// ---------------------------------------------------------------------------

export interface Term {
  /** "<context>.<slug>" - auth.session. A word means one thing per context. */
  id: string;
  slug: string;
  /** The context whose vocabulary this is, never the service the file sat in. */
  context: string;
  /** As the glossary spells it, which is how the code spells it: "Email address". */
  name: string;
  /** What it means, as the glossary's own paragraph: markdown, one line. */
  definition: string;
  /** `path:line` of the entry, as everything else in the catalog spells a source. */
  source: string;
}

/** Every term in every glossary. Absent means none, exactly as with modules. */
export function allTerms(catalog: Catalog): Term[] {
  return catalog.terms ?? [];
}
