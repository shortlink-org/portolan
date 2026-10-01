import type { Aggregate, Catalog, Lifecycle } from "../catalog-model.ts";
import { aggregateBlocks, enumsOf, rootEntity } from "../catalog-model.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";

/**
 * An aggregate is a root entity plus the entities and value objects it owns.
 * The root has to be one of those entities: an aggregate that names a root it
 * does not list is a modelling mistake, not a rendering one, and the tree would
 * quietly print a line pointing at nothing.
 */
/**
 * An enum is a set: its slug is unique among the aggregate's enums, its id
 * is spelled from the aggregate's, and its values are named once each and
 * are at least one. An empty enum is not a fact about a closed set, it is a
 * reader that found the type and none of its members.
 */
function validateEnums(aggregate: Aggregate): void {
  if (aggregate.enums !== undefined && !Array.isArray(aggregate.enums)) {
    fail(
      `aggregate "${aggregate.id}" has an enums list that is not a list`,
      `aggregate ${aggregate.id}`,
    );
  }
  const enums = enumsOf(aggregate);
  assertUniqueSlugs(
    enums.map((e) => e.slug),
    `aggregate "${aggregate.id}"`,
    "enum",
  );
  for (const item of enums) {
    const where = `aggregate ${aggregate.id} / enum ${item.slug}`;
    if (item.id !== `${aggregate.id}.${item.slug}`) {
      fail(
        `enum "${item.id}" in aggregate "${aggregate.id}" must have id "${aggregate.id}.${item.slug}"`,
        where,
      );
    }
    if (!Array.isArray(item.values) || item.values.length === 0) {
      fail(`enum "${item.id}" has no values`, where);
    }
    const seen = new Set<string>();
    for (const value of item.values) {
      if (!value.name) {
        fail(`enum "${item.id}" has a value with no name`, where);
      }
      if (seen.has(value.name)) {
        fail(`enum "${item.id}" lists value "${value.name}" twice`, where);
      }
      seen.add(value.name);
    }
  }
}

export function validateBlocks(catalog: Catalog, aggregate: Aggregate): void {
  for (const [what, list] of [
    ["entities", aggregate.entities],
    ["valueObjects", aggregate.valueObjects],
  ] as const) {
    if (!Array.isArray(list)) {
      fail(
        `aggregate "${aggregate.id}" is missing its ${what} list`,
        `aggregate ${aggregate.id}`,
      );
    }
  }

  assertUniqueSlugs(
    aggregate.entities.map((e) => e.slug),
    `aggregate "${aggregate.id}"`,
    "entity",
  );
  assertUniqueSlugs(
    aggregate.valueObjects.map((v) => v.slug),
    `aggregate "${aggregate.id}"`,
    "value object",
  );

  for (const { kind, block } of aggregateBlocks(aggregate)) {
    const what = kind === "vo" ? "value object" : "entity";
    if (block.id !== `${aggregate.id}.${block.slug}`) {
      fail(
        `${what} "${block.id}" in aggregate "${aggregate.id}" must have id "${aggregate.id}.${block.slug}"`,
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    if (block.ref !== undefined && !(block.ref in catalog.defs)) {
      fail(
        `${what} "${block.id}" references unknown def "${block.ref}"`,
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    if (block.ref === undefined && (block.fields ?? []).length === 0) {
      fail(
        `${what} "${block.id}" has neither a def ref nor any fields of its own`,
        `aggregate ${aggregate.id} / ${what} ${block.slug}`,
      );
    }
    for (const field of block.fields ?? []) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of ${what} "${block.id}" references unknown def "${field.ref}"`,
          `aggregate ${aggregate.id} / ${what} ${block.slug} / field ${field.name}`,
        );
      }
    }
  }

  validateEnums(aggregate);

  if (aggregate.kind !== undefined && aggregate.kind !== "model-group") {
    fail(`aggregate "${aggregate.id}" has an unknown kind`, `aggregate ${aggregate.id}`);
  }
  if (aggregate.kind === "model-group") {
    if (aggregate.root !== "" || aggregate.lifecycle) {
      fail(`model group "${aggregate.id}" cannot declare an aggregate root or lifecycle`, `aggregate ${aggregate.id}`);
    }
    return;
  }
  if (!aggregate.root) {
    fail(
      `aggregate "${aggregate.id}" names no root entity`,
      `aggregate ${aggregate.id}`,
    );
  }
  if (!rootEntity(aggregate)) {
    fail(
      `aggregate "${aggregate.id}" names root "${aggregate.root}", which is not one of its entities`,
      `aggregate ${aggregate.id}`,
    );
  }
  if (aggregate.lifecycle) validateLifecycle(aggregate, aggregate.lifecycle);
}

/**
 * A lifecycle names only states it lists and events the aggregate owns. A
 * transition into a state nobody listed is a typo that would draw a box the
 * code never reaches; a transition emitting an event of another aggregate is
 * a claim the aggregate's own page could not follow.
 */
function validateLifecycle(aggregate: Aggregate, lifecycle: Lifecycle): void {
  const where = `aggregate ${aggregate.id} / lifecycle`;
  if (lifecycle.states.length === 0) {
    fail(`aggregate "${aggregate.id}" has a lifecycle with no states`, where);
  }
  const states = new Set<string>();
  for (const state of lifecycle.states) {
    if (states.has(state)) {
      fail(`aggregate "${aggregate.id}" lists state "${state}" twice`, where);
    }
    states.add(state);
  }
  const events = new Set(aggregate.events.map((e) => e.id));
  for (const t of lifecycle.transitions) {
    for (const end of [t.from, t.to]) {
      if (!states.has(end)) {
        fail(
          `aggregate "${aggregate.id}" moves ${t.from} → ${t.to} on ${t.on}, and "${end}" is not one of its states`,
          where,
        );
      }
    }
    if (!t.on) {
      fail(
        `aggregate "${aggregate.id}" moves ${t.from} → ${t.to} on nothing`,
        where,
      );
    }
    if (t.emits !== undefined && !events.has(t.emits)) {
      fail(
        `aggregate "${aggregate.id}" moves ${t.from} → ${t.to} emitting "${t.emits}", which is not one of its events`,
        where,
      );
    }
  }
}
