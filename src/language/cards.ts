// The glossary, arranged for reading. Pure: a catalog in, plain values out,
// so what the page shows can be asserted in a test rather than eyeballed.
//
// Two arrangements, and the second is the one that earns the page. A context's
// vocabulary is a list anyone could have written by hand; the words that mean
// two things in two contexts are only visible once every glossary in the
// estate is in one place, and they are exactly what a reader crossing a
// boundary gets wrong.

import type { BoundedContext, Catalog, Term } from "../catalog";
import { allTerms } from "../catalog";

/** One context's words, alphabetical, however the sources were ordered. */
export interface Vocabulary {
  contextId: string;
  /** The context itself, when the catalog declares one. */
  context: BoundedContext | null;
  terms: Term[];
}

function byName(a: Term, b: Term): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * Every vocabulary, in catalog order - which is the order the contexts are
 * drawn in everywhere else, so the page reads in the same direction as the
 * sidebar and the map.
 */
export function vocabularies(catalog: Catalog): Vocabulary[] {
  const byContext = new Map<string, Term[]>();
  for (const term of allTerms(catalog)) {
    const list = byContext.get(term.context) ?? [];
    list.push(term);
    byContext.set(term.context, list);
  }

  const out: Vocabulary[] = [];
  for (const context of catalog.contexts) {
    const terms = byContext.get(context.id);
    if (!terms) continue;
    out.push({ contextId: context.id, context, terms: [...terms].sort(byName) });
    byContext.delete(context.id);
  }
  // A glossary whose context is not in the catalog cannot happen - the
  // validator refuses it - but the arrangement does not depend on that being
  // true, because a list that silently drops rows is worse than one that
  // shows them somewhere plain.
  for (const [contextId, terms] of byContext) {
    out.push({ contextId, context: null, terms: [...terms].sort(byName) });
  }

  return out;
}

/** One word, and the contexts that mean different things by it. */
export interface Homonym {
  /** The shared slug - what makes two spellings one word. */
  slug: string;
  /** As the glossaries spell it, taking the first if they disagree in case. */
  word: string;
  terms: Term[];
}

/**
 * The words that appear in more than one context.
 *
 * Not a problem to fix. `User` in auth is an id, an email and a hash; `User`
 * in shop is a name and an address - two entries is the correct answer, and
 * the layout rules say so. What is worth seeing is that a reader crossing the
 * boundary is now holding two meanings of one word, which no single glossary
 * can tell them.
 */
export function homonyms(catalog: Catalog): Homonym[] {
  const bySlug = new Map<string, Term[]>();
  for (const term of allTerms(catalog)) {
    const list = bySlug.get(term.slug) ?? [];
    list.push(term);
    bySlug.set(term.slug, list);
  }

  const out: Homonym[] = [];
  for (const [slug, terms] of bySlug) {
    // Two entries of one context cannot happen either - the merge reports it -
    // so counting contexts rather than terms is the honest test of "the same
    // word, twice".
    if (new Set(terms.map((t) => t.context)).size < 2) continue;
    out.push({
      slug,
      word: terms[0]?.name ?? slug,
      terms: [...terms].sort((a, b) => a.context.localeCompare(b.context)),
    });
  }

  return out.sort((a, b) => a.word.localeCompare(b.word));
}

/**
 * The filter box: every word of the query has to appear somewhere in the
 * entry, in any order.
 */
export function matchTerms(terms: Term[], query: string): Term[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return terms;

  return terms.filter((term) => {
    const haystack =
      `${term.name} ${term.slug} ${term.definition}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
