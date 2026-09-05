// What a word in the glossary names in the model, and what a thing in the
// model is called in the glossary.
//
// One rule: the term's slug, matched exactly, inside its own context. Nothing
// fuzzy, and deliberately so. `Register` and `registerUser` are the same idea
// and a matcher clever enough to pair them is also clever enough to pair
// `Line` with `Lineage`; a wrong link between a definition and a type is worse
// than no link, because the reader believes it.
//
// So the binding is a BONUS, not a measurement. In the example estate it pairs
// twelve of auth's twenty-seven words and seven of shop's eleven, and the ones
// it leaves alone - Bus, Outbox, Policy, Refusal, Conflict - are not failures:
// they are the concepts a glossary exists to define, which name no type at all.
// Nothing here counts, scores or reports; there is no coverage to chase.

import type { Catalog, Term } from "../catalog";
import type { Kind } from "./kinds";
import { AGGREGATE_ANCHOR, paths } from "../routes";

/**
 * Something in the model that a term names. `state` is not one of the app's
 * kinds - a lifecycle state has no page and no icon of its own - so it says so
 * here rather than borrowing a kind it is not.
 */
export interface TermTarget {
  kind: Kind | "state";
  /** The catalog id, or the addressable key for the things that have no id. */
  id: string;
  name: string;
  path: string;
}

export interface TermBindings {
  /** term id -> what it names, in the order the catalog declares them */
  byTerm: Map<string, TermTarget[]>;
  /** catalog id -> the term that names it */
  byTarget: Map<string, Term>;
}

/** The key an operation is addressed by, the same one the palette uses. */
function operationKey(aggregateId: string, operationId: string): string {
  return `${aggregateId}#${operationId}`;
}

/** A lifecycle state has no id of its own, so it is addressed by its holder. */
function stateKey(aggregateId: string, state: string): string {
  return `${aggregateId}#state:${state}`;
}

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every pairing in the estate, in one pass.
 *
 * Both directions come out of the same walk because they are the same fact
 * read from two ends: a page asking "what is this called?" and a card asking
 * "what does this word name?" must never disagree.
 */
export function bindTerms(catalog: Catalog): TermBindings {
  const byTerm = new Map<string, TermTarget[]>();
  const byTarget = new Map<string, Term>();

  const terms = new Map<string, Term>();
  for (const term of catalog.terms ?? []) terms.set(term.id, term);
  if (terms.size === 0) return { byTerm, byTarget };

  const pair = (context: string, slug: string, target: TermTarget): void => {
    const term = terms.get(`${context}.${slug}`);
    if (!term) return;

    const found = byTerm.get(term.id) ?? [];
    found.push(target);
    byTerm.set(term.id, found);
    byTarget.set(target.id, term);
  };

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const aggregate of service.aggregates) {
        const page = paths.aggregate(context.id, service.slug, aggregate.slug);

        pair(context.id, aggregate.slug, {
          kind: "aggregate",
          id: aggregate.id,
          name: aggregate.name,
          path: page,
        });

        for (const event of aggregate.events) {
          pair(context.id, event.slug, {
            kind: "event",
            id: event.id,
            name: event.name,
            path: paths.event(
              context.id,
              service.slug,
              aggregate.slug,
              event.slug,
            ),
          });
        }

        for (const vo of aggregate.valueObjects) {
          pair(context.id, vo.slug, {
            kind: "vo",
            id: vo.id,
            name: vo.name,
            path: paths.valueObject(
              context.id,
              service.slug,
              aggregate.slug,
              vo.slug,
            ),
          });
        }

        for (const entity of aggregate.entities) {
          pair(context.id, entity.slug, {
            kind: "entity",
            id: entity.id,
            name: entity.name,
            path: paths.entity(
              context.id,
              service.slug,
              aggregate.slug,
              entity.slug,
            ),
          });
        }

        // A command, a query and a state land on the aggregate that holds
        // them, at the section that lists them: none of the three has a page.
        for (const operation of aggregate.operations) {
          pair(context.id, slugOf(operation.id), {
            kind: operation.kind,
            id: operationKey(aggregate.id, operation.id),
            name: operation.id,
            path: `${page}#${
              operation.kind === "command"
                ? AGGREGATE_ANCHOR.commands
                : AGGREGATE_ANCHOR.queries
            }`,
          });
        }

        for (const state of aggregate.lifecycle?.states ?? []) {
          pair(context.id, slugOf(state), {
            kind: "state",
            id: stateKey(aggregate.id, state),
            name: state,
            path: `${page}#${AGGREGATE_ANCHOR.lifecycle}`,
          });
        }
      }
    }
  }

  return { byTerm, byTarget };
}
