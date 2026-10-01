import type { Catalog } from "../catalog-model.ts";
import {
  REDIS_OPERATIONS,
  STORE_KINDS,
  TABLE_OPERATIONS,
  TABLE_ROLES,
  aggregateBlocks,
  allAggregates,
  allServices,
  allStores,
  columnNameOfId,
  relationOfColumnId,
  storeViews,
} from "../catalog-model.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";

/**
 * A schema may only point at things that exist. A foreign key into a table
 * nobody declared, or a `persists` naming an aggregate that is not in the
 * catalog, would draw an edge into open water on a canvas whose whole job is
 * to show where the edges land — so both fail the build.
 *
 * What is NOT checked here: whether an outbox actually carries a payload, and
 * whether a table's columns still match the aggregate it claims to persist.
 * Those are judgements about a model that is allowed to be mid-migration, and
 * they are reported on the Problems page as warnings rather than refusing to
 * render the catalog at all.
 */
export function validateStores(catalog: Catalog): void {
  const stores = allStores(catalog);
  if (stores.length === 0) return;

  const services = new Map(allServices(catalog).map((s) => [s.id, s]));
  const serviceIds = new Set(services.keys());
  const aggregates = new Map(allAggregates(catalog).map((a) => [a.id, a]));

  assertUniqueSlugs(
    stores.map((s) => s.id),
    "catalog",
    "store",
  );

  // Every table id first: a foreign key may point forwards, at a table in a
  // store declared later in the file.
  const columnsOfTable = new Map<string, Set<string>>();
  for (const store of stores) {
    for (const table of store.tables) {
      if (columnsOfTable.has(table.id)) {
        fail(`table id "${table.id}" is not unique`, `store ${store.id}`);
      }
      columnsOfTable.set(table.id, new Set(table.columns.map((c) => c.name)));
    }
  }

  // Views join the same namespace: a database will not let a view and a table
  // share a name, and lineage points at both, so one map answers "does this id
  // exist, and does it have that column" for either.
  const columnsOfRelation = new Map(columnsOfTable);
  for (const store of stores) {
    for (const view of storeViews(store)) {
      if (columnsOfRelation.has(view.id)) {
        fail(
          `view id "${view.id}" collides with another table or view`,
          `store ${store.id}`,
        );
      }
      columnsOfRelation.set(view.id, new Set(view.columns.map((c) => c.name)));
    }
  }

  /** A column reference — "<relation id>.<column>" — that has to resolve. */
  const checkColumnRef = (ref: string, where: string, what: string): void => {
    const relation = relationOfColumnId(ref);
    const columns = columnsOfRelation.get(relation);
    if (!columns) {
      fail(
        `${what} names "${ref}", and "${relation}" is not a table or view in the catalog`,
        where,
      );
    } else if (!columns.has(columnNameOfId(ref))) {
      fail(
        `${what} names "${ref}", and "${relation}" has no column "${columnNameOfId(ref)}"`,
        where,
      );
    }
  };

  for (const store of stores) {
    if (store.id !== `${store.owner}.${store.slug}`) {
      fail(
        `store "${store.id}" is owned by "${store.owner}", so its id must be "${store.owner}.${store.slug}"`,
        `store ${store.id}`,
      );
    }
    if (!serviceIds.has(store.owner)) {
      fail(
        `store "${store.id}" is owned by "${store.owner}", which is not a service in the catalog`,
        `store ${store.id}`,
      );
    }
    // A store is drawn inside the service that owns it, beside that service's
    // aggregates, so the two share one namespace in the architecture model. A
    // store whose slug is also an aggregate's would be one box standing for
    // two things, and the id it is clicked by would answer with whichever was
    // registered first.
    if (
      services.get(store.owner)?.aggregates.some((a) => a.slug === store.slug)
    ) {
      fail(
        `store "${store.id}" has the slug of an aggregate of "${store.owner}"`,
        `store ${store.id}`,
      );
    }
    if (!STORE_KINDS.includes(store.kind)) {
      fail(
        `store "${store.id}" has kind "${store.kind}"; expected one of ${STORE_KINDS.join(", ")}`,
        `store ${store.id}`,
      );
    }

    const keyPatterns = new Set<string>();
    for (const keyspace of store.keyspaces ?? []) {
      const where = `store ${store.id} / Redis key ${keyspace.pattern}`;
      if (store.kind !== "redis") {
        fail(
          `store "${store.id}" declares Redis key patterns but has kind "${store.kind}"`,
          where,
        );
      }
      if (!keyspace.pattern) {
        fail(`store "${store.id}" has an empty Redis key pattern`, where);
      }
      if (keyPatterns.has(keyspace.pattern)) {
        fail(
          `store "${store.id}" repeats Redis key pattern "${keyspace.pattern}"`,
          where,
        );
      }
      keyPatterns.add(keyspace.pattern);
      if (keyspace.operations.length === 0) {
        fail(
          `Redis key pattern "${keyspace.pattern}" has no operations`,
          where,
        );
      }
      const operations = new Set<string>();
      for (const operation of keyspace.operations) {
        if (!REDIS_OPERATIONS.includes(operation)) {
          fail(
            `Redis key pattern "${keyspace.pattern}" has operation "${operation}"; expected one of ${REDIS_OPERATIONS.join(", ")}`,
            where,
          );
        }
        if (operations.has(operation)) {
          fail(
            `Redis key pattern "${keyspace.pattern}" repeats operation "${operation}"`,
            where,
          );
        }
        operations.add(operation);
      }
      const aggregateId = keyspace.persists?.aggregate;
      if (aggregateId && !aggregates.has(aggregateId)) {
        fail(
          `Redis key pattern "${keyspace.pattern}" persists unknown aggregate "${aggregateId}"`,
          where,
        );
      }
      const blockId = keyspace.persists?.block;
      if (blockId) {
        const blockAggregate =
          aggregates.get(blockId.split(".").slice(0, -1).join("."));
        const belongs = blockAggregate
          ? aggregateBlocks(blockAggregate).some(({ block }) => block.id === blockId)
          : false;
        if (!belongs) {
          fail(
            `Redis key pattern "${keyspace.pattern}" persists unknown block "${blockId}"`,
            where,
          );
        }
      }
      for (const access of keyspace.accesses ?? []) {
        if (!REDIS_OPERATIONS.includes(access.operation)) {
          fail(
            `Redis key pattern "${keyspace.pattern}" has access operation "${access.operation}"; expected one of ${REDIS_OPERATIONS.join(", ")}`,
            where,
          );
        }
        if (!operations.has(access.operation)) {
          fail(
            `Redis key pattern "${keyspace.pattern}" has ${access.operation} access absent from its operations summary`,
            where,
          );
        }
      }
    }

    for (const table of store.tables) {
      const where = `store ${store.id} / table ${table.name}`;
      if (table.id !== `${store.id}.${table.name}`) {
        fail(
          `table "${table.id}" in store "${store.id}" must have id "${store.id}.${table.name}"`,
          where,
        );
      }
      if (table.role !== undefined && !TABLE_ROLES.includes(table.role)) {
        fail(
          `table "${table.id}" has role "${table.role}"; expected one of ${TABLE_ROLES.join(", ")}`,
          where,
        );
      }
      for (const access of table.accesses ?? []) {
        if (!TABLE_OPERATIONS.includes(access.operation)) {
          fail(
            `table "${table.id}" has access operation "${access.operation}"; expected one of ${TABLE_OPERATIONS.join(", ")}`,
            where,
          );
        }
      }

      const own = columnsOfTable.get(table.id) ?? new Set<string>();
      if (own.size !== table.columns.length) {
        fail(`table "${table.id}" has duplicate column names`, where);
      }

      const aggregateId = table.persists?.aggregate;
      const aggregate = aggregateId ? aggregates.get(aggregateId) : undefined;
      if (aggregateId && !aggregate) {
        fail(
          `table "${table.id}" persists unknown aggregate "${aggregateId}"`,
          where,
        );
      }
      const blockId = table.persists?.block;
      if (blockId) {
        // A block is named "<aggregate id>.<slug>", so a block belonging to
        // another aggregate than the one the table persists is a contradiction
        // the id itself spells out.
        const owner =
          aggregate ??
          aggregates.get(blockId.split(".").slice(0, -1).join("."));
        const found = owner
          ? aggregateBlocks(owner).some((b) => b.block.id === blockId)
          : false;
        if (!found) {
          fail(
            `table "${table.id}" persists block "${blockId}", which is not a block of ${aggregateId ? `aggregate "${aggregateId}"` : "any aggregate in the catalog"}`,
            where,
          );
        }
      }

      for (const index of table.indexes ?? []) {
        for (const column of index.columns) {
          if (!own.has(column)) {
            fail(
              `index "${index.name}" on table "${table.id}" names column "${column}", which the table does not have`,
              where,
            );
          }
        }
      }

      for (const column of table.columns) {
        for (const ref of column.from ?? []) {
          const self = `${table.id}.${column.name}`;
          if (ref === self) {
            fail(
              `column "${self}" is declared as derived from itself`,
              `${where} / column ${column.name}`,
            );
          }
          checkColumnRef(
            ref,
            `${where} / column ${column.name}`,
            `column "${column.name}" of table "${table.id}" is derived from a column that`,
          );
        }
        if (!column.fk) continue;
        const target = columnsOfTable.get(column.fk.table);
        if (!target) {
          fail(
            `column "${column.name}" of table "${table.id}" has a foreign key into "${column.fk.table}", which is not a table in the catalog`,
            `${where} / column ${column.name}`,
          );
        } else if (!target.has(column.fk.column)) {
          fail(
            `column "${column.name}" of table "${table.id}" has a foreign key into "${column.fk.table}.${column.fk.column}", and that table has no such column`,
            `${where} / column ${column.name}`,
          );
        }
      }
    }

    for (const view of storeViews(store)) {
      const where = `store ${store.id} / view ${view.name}`;
      if (view.id !== `${store.id}.${view.name}`) {
        fail(
          `view "${view.id}" in store "${store.id}" must have id "${store.id}.${view.name}"`,
          where,
        );
      }

      const own = columnsOfRelation.get(view.id) ?? new Set<string>();
      if (own.size !== view.columns.length) {
        fail(`view "${view.id}" has duplicate column names`, where);
      }

      const aggregateId = view.persists?.aggregate;
      if (aggregateId && !aggregates.has(aggregateId)) {
        fail(
          `view "${view.id}" presents unknown aggregate "${aggregateId}"`,
          where,
        );
      }

      for (const readId of view.reads ?? []) {
        if (readId === view.id) {
          fail(`view "${view.id}" is declared as reading itself`, where);
        }
        if (!columnsOfRelation.has(readId)) {
          fail(
            `view "${view.id}" reads "${readId}", which is not a table or view in the catalog`,
            where,
          );
        }
      }

      for (const column of view.columns) {
        const at = `${where} / column ${column.name}`;
        // A view has no rows of its own, so it has no key of its own either.
        // Saying otherwise would put a key glyph on a card that cannot enforce
        // one, which is the sort of small lie a schema browser exists to stop.
        if (column.pk) {
          fail(
            `column "${column.name}" of view "${view.id}" is marked as a primary key; a view has no key of its own`,
            at,
          );
        }
        if (column.fk) {
          fail(
            `column "${column.name}" of view "${view.id}" declares a foreign key; a view states what it reads through lineage, not through constraints`,
            at,
          );
        }
        for (const ref of column.from ?? []) {
          if (ref === `${view.id}.${column.name}`) {
            fail(
              `column "${view.id}.${column.name}" is declared as derived from itself`,
              at,
            );
          }
          checkColumnRef(
            ref,
            at,
            `column "${column.name}" of view "${view.id}" is derived from a column that`,
          );
        }
      }
    }
  }

  const storeIds = new Set(stores.map((s) => s.id));
  for (const service of allServices(catalog)) {
    for (const storeId of service.stores ?? []) {
      if (!storeIds.has(storeId)) {
        fail(
          `service "${service.id}" lists unknown store "${storeId}"`,
          `service ${service.id}`,
        );
      }
    }
  }
}
