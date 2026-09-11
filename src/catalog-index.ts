import type {
  Adr,
  Aggregate,
  Block,
  BlockKind,
  BoundedContext,
  Catalog,
  Column,
  Deployment,
  Enum,
  Event,
  External,
  Flow,
  ProtoModule,
  RedisKeyspace,
  RpcCall,
  RpcService,
  Service,
  Store,
  Table,
  Term,
  View,
} from "./catalog-model.ts";
import {
  allDeployments,
  allExternals,
  allModules,
  allStores,
  allTerms,
  aggregateBlocks,
  columnId,
  deploys,
  enumsOf,
  storeViews,
  viewReads,
  walkSteps,
} from "./catalog-model.ts";

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/** Everything needed to render or link a block without walking the tree again. */
export interface BlockOwner {
  block: Block;
  kind: BlockKind;
  aggregate: Aggregate;
  service: Service;
  context: BoundedContext;
}

/** An enum and everything that owns it, so a value can be drawn without a lookup. */
export interface EnumOwner {
  enum: Enum;
  aggregate: Aggregate;
  service: Service;
  context: BoundedContext;
}

/** A column and everything holding it, so a row can be drawn without a lookup. */
export interface ColumnOwner {
  column: Column;
  table: Table;
  store: Store;
}

/** The same, for a column of a view. Kept apart so `owner.table` never lies. */
export interface ViewColumnOwner {
  column: Column;
  view: View;
  store: Store;
}

/**
 * The block a `maps` path points into, by name. A path is "<Type>.<Field>", and
 * the type is resolved inside the aggregate the table already says it persists
 * — the only scope in which a bare type name is unambiguous.
 */
export function mapsBlockId(
  aggregate: Aggregate | undefined,
  maps: string | undefined,
): string | null {
  if (!aggregate || !maps) return null;
  const head = maps.split(".")[0];
  if (!head) return null;
  const found = aggregateBlocks(aggregate).find((b) => b.block.name === head);
  return found ? found.block.id : null;
}

/** The field half of a `maps` path — everything after the type name. */
export function mapsFieldPath(maps: string): string {
  const at = maps.indexOf(".");
  return at < 0 ? maps : maps.slice(at + 1);
}

export interface CatalogIndex {
  catalog: Catalog;
  serviceById: Map<string, Service>;
  serviceContext: Map<string, BoundedContext>;
  aggregateById: Map<string, Aggregate>;
  aggregateOwner: Map<string, Service>;
  eventById: Map<string, Event>;
  eventOwner: Map<string, { service: Service; aggregate: Aggregate }>;
  /**
   * wire name -> the event that goes out under it.
   *
   * The one lookup that starts from the bus rather than from the catalog. A
   * subscriber names a message and knows nothing else about it, and this is
   * what turns that name back into the event, its aggregate and its owner.
   * Only events are in here: a channel declared by a document is a promise,
   * and a promise is not a page anything can link to.
   */
  eventByWireName: Map<string, Event>;
  /** value object and entity id -> the block and everything that owns it */
  blockById: Map<string, BlockOwner>;
  /** enum id -> the enum and everything that owns it */
  enumById: Map<string, EnumOwner>;
  /** defs key -> ids of the blocks that name it */
  blocksByDef: Map<string, string[]>;
  rpcById: Map<string, RpcCall>;
  rpcProviderByMethod: Map<string, Service>;
  externalById: Map<string, External>;
  /**
   * "<interface>/<method>" -> the external answering on it. Kept apart from
   * `rpcProviderByMethod` rather than widened into it: every reader of that map
   * follows the provider to a service page, and an external has none.
   */
  externalProviderByMethod: Map<string, External>;
  storeById: Map<string, Store>;
  /** table id -> the table and the store holding it */
  tableById: Map<string, { table: Table; store: Store }>;
  /** view id -> the view and the store declaring it */
  viewById: Map<string, { view: View; store: Store }>;
  /** column id -> the column and everything that owns it */
  columnById: Map<string, ColumnOwner>;
  /** column id -> the view column and everything that owns it */
  viewColumnById: Map<string, ViewColumnOwner>;
  /** table or view id -> the views reading it, in catalog order */
  viewsReading: Map<string, View[]>;
  /** column id -> the column ids it is computed from, in declaration order */
  lineageFrom: Map<string, string[]>;
  /** column id -> the column ids computed from it, in catalog order */
  lineageInto: Map<string, string[]>;
  /** service id -> stores it owns, in catalog order */
  storesOwnedBy: Map<string, Store[]>;
  /**
   * service id -> where it runs, in snapshot order.
   *
   * Joined here rather than written by the fetcher, which reads a control
   * plane and knows no service: an Application is this service's when it
   * deploys from the service's repository, inside the service's directory.
   */
  deploymentsByService: Map<string, Deployment[]>;
  /** aggregate id -> tables naming it in `persists`, in catalog order */
  tablesByAggregate: Map<string, Table[]>;
  /** aggregate id -> views naming it in `persists`, in catalog order */
  viewsByAggregate: Map<string, View[]>;
  /** aggregate id -> Redis key families holding it, in catalog order */
  keyspacesByAggregate: Map<string, RedisKeyspaceOwner[]>;
  /** block id -> columns whose `maps` path lands in that block */
  columnsByBlock: Map<string, ColumnOwner[]>;
  /** table id -> the columns pointing at it through a foreign key */
  fkIntoTable: Map<string, ColumnOwner[]>;
  flowBySlug: Map<string, Flow>;
  /** event id -> flow slugs that reference it in a step */
  flowsByEvent: Map<string, string[]>;
  moduleById: Map<string, ProtoModule>;
  moduleBySlug: Map<string, ProtoModule>;
  /** module id -> the interfaces declaring themselves part of it, with their service */
  interfacesByModule: Map<string, InterfaceOwner[]>;
  /**
   * module id -> services that publish it, vendor it, or name it on a call.
   *
   * The interesting fact about a module is usually who ELSE reads it, and no
   * single field says so: a producer names it on an interface, a consumer on a
   * call, and either may list it under `Service.modules`. One map answers it.
   */
  servicesUsingModule: Map<string, Service[]>;
  adrById: Map<string, Adr>;
  adrBySlug: Map<string, Adr>;
  /** event id -> ADRs that name it in relates.events, newest first */
  adrsByEvent: Map<string, Adr[]>;
  termById: Map<string, Term>;
  /** context id -> its vocabulary, alphabetical, as the glossary was written */
  termsByContext: Map<string, Term[]>;
}

/** An interface and the service that answers on it. */
export interface InterfaceOwner {
  service: Service;
  provided: RpcService;
}

export interface RedisKeyspaceOwner {
  keyspace: RedisKeyspace;
  store: Store;
}

export function buildIndex(catalog: Catalog): CatalogIndex {
  const serviceById = new Map<string, Service>();
  const serviceContext = new Map<string, BoundedContext>();
  const moduleById = new Map<string, ProtoModule>();
  const moduleBySlug = new Map<string, ProtoModule>();
  const interfacesByModule = new Map<string, InterfaceOwner[]>();
  const servicesUsingModule = new Map<string, Service[]>();
  const aggregateById = new Map<string, Aggregate>();
  const aggregateOwner = new Map<string, Service>();
  const eventById = new Map<string, Event>();
  const eventByWireName = new Map<string, Event>();
  const eventOwner = new Map<
    string,
    { service: Service; aggregate: Aggregate }
  >();
  const blockById = new Map<string, BlockOwner>();
  const enumById = new Map<string, EnumOwner>();
  const blocksByDef = new Map<string, string[]>();
  const rpcById = new Map<string, RpcCall>();
  const rpcProviderByMethod = new Map<string, Service>();
  const externalById = new Map<string, External>();
  const externalProviderByMethod = new Map<string, External>();
  for (const external of allExternals(catalog)) {
    externalById.set(external.id, external);
    for (const provided of external.provides) {
      for (const method of provided.methods) {
        externalProviderByMethod.set(`${provided.id}/${method.name}`, external);
      }
    }
  }
  const flowBySlug = new Map<string, Flow>();
  const flowsByEvent = new Map<string, string[]>();
  const adrById = new Map<string, Adr>();
  const adrBySlug = new Map<string, Adr>();
  const adrsByEvent = new Map<string, Adr[]>();
  const termById = new Map<string, Term>();
  const termsByContext = new Map<string, Term[]>();
  const storeById = new Map<string, Store>();
  const tableById = new Map<string, { table: Table; store: Store }>();
  const viewById = new Map<string, { view: View; store: Store }>();
  const columnById = new Map<string, ColumnOwner>();
  const viewColumnById = new Map<string, ViewColumnOwner>();
  const viewsReading = new Map<string, View[]>();
  const lineageFrom = new Map<string, string[]>();
  const lineageInto = new Map<string, string[]>();
  const storesOwnedBy = new Map<string, Store[]>();
  const tablesByAggregate = new Map<string, Table[]>();
  const viewsByAggregate = new Map<string, View[]>();
  const keyspacesByAggregate = new Map<string, RedisKeyspaceOwner[]>();
  const columnsByBlock = new Map<string, ColumnOwner[]>();
  const fkIntoTable = new Map<string, ColumnOwner[]>();

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      serviceById.set(service.id, service);
      serviceContext.set(service.id, context);
      for (const call of service.consumes) rpcById.set(call.id, call);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          rpcProviderByMethod.set(`${provided.id}/${method.name}`, service);
        }
      }
      for (const aggregate of service.aggregates) {
        aggregateById.set(aggregate.id, aggregate);
        aggregateOwner.set(aggregate.id, service);
        for (const event of aggregate.events) {
          eventById.set(event.id, event);
          eventOwner.set(event.id, { service, aggregate });
          // First one wins, and two events sharing a wire name is a problem
          // the Problems page is the place to say so about, not this.
          if (event.wire && !eventByWireName.has(event.wire.name)) {
            eventByWireName.set(event.wire.name, event);
          }
        }
        for (const item of enumsOf(aggregate)) {
          enumById.set(item.id, { enum: item, aggregate, service, context });
        }
        for (const { kind, block } of aggregateBlocks(aggregate)) {
          blockById.set(block.id, { block, kind, aggregate, service, context });
          if (block.ref) {
            const list = blocksByDef.get(block.ref) ?? [];
            list.push(block.id);
            blocksByDef.set(block.ref, list);
          }
        }
      }
    }
  }

  // Lineage is recorded from the derived end, which is the only end that
  // declares it, and both directions are kept: "where did this come from" and
  // "who reads this" are asked as often as each other, and answering the
  // second by scanning every column in the catalog is what an index is for.
  const recordLineage = (id: string, column: Column): void => {
    const sources = column.from ?? [];
    if (sources.length === 0) return;
    lineageFrom.set(id, [...sources]);
    for (const source of sources) {
      const list = lineageInto.get(source) ?? [];
      if (!list.includes(id)) list.push(id);
      lineageInto.set(source, list);
    }
  };

  // Modules are collected from both ends: the top-level list says what exists,
  // and the services say who touches it. A module named by a service the
  // catalog has no entry for is refused by the validator, so nothing here has
  // to guess.
  for (const module of allModules(catalog)) {
    moduleById.set(module.id, module);
    moduleBySlug.set(module.slug, module);
  }

  const uses = (moduleId: string, service: Service) => {
    const list = servicesUsingModule.get(moduleId) ?? [];
    if (!list.includes(service)) list.push(service);
    servicesUsingModule.set(moduleId, list);
  };

  for (const context of catalog.contexts) {
    for (const service of context.services) {
      for (const moduleId of service.modules ?? []) uses(moduleId, service);
      for (const provided of service.provides) {
        if (provided.module === undefined) continue;
        const list = interfacesByModule.get(provided.module) ?? [];
        list.push({ service, provided });
        interfacesByModule.set(provided.module, list);
        uses(provided.module, service);
      }
      for (const copy of service.copies ?? []) {
        if (copy.module !== undefined) uses(copy.module, service);
      }
      for (const call of service.consumes) {
        if (call.module !== undefined) uses(call.module, service);
      }
    }
  }

  // Deployments come after the services because the join runs over them: a
  // row is placed on every service whose repository and directory it deploys
  // from, and on none when nobody in the estate claims that repository.
  const deploymentsByService = new Map<string, Deployment[]>();
  for (const deployment of allDeployments(catalog)) {
    for (const service of serviceById.values()) {
      if (!deploys(deployment, service)) continue;
      const placed = deploymentsByService.get(service.id) ?? [];
      placed.push(deployment);
      deploymentsByService.set(service.id, placed);
    }
  }

  // Stores come after the domain tree because they point into it: a table says
  // which aggregate it persists, and a column which block it maps to, so both
  // are resolved against maps that are already full.
  for (const store of allStores(catalog)) {
    storeById.set(store.id, store);
    const owned = storesOwnedBy.get(store.owner) ?? [];
    owned.push(store);
    storesOwnedBy.set(store.owner, owned);

    for (const keyspace of store.keyspaces ?? []) {
      const aggregateId = keyspace.persists?.aggregate;
      if (!aggregateId) continue;
      const list = keyspacesByAggregate.get(aggregateId) ?? [];
      list.push({ keyspace, store });
      keyspacesByAggregate.set(aggregateId, list);
    }

    for (const table of store.tables) {
      tableById.set(table.id, { table, store });
      // A table may name only the block it holds. That block belongs to an
      // aggregate, and an aggregate's Persistence section has to list it, so
      // the owner is filled in here rather than asked for twice in the JSON.
      const aggregateId =
        table.persists?.aggregate ??
        (table.persists?.block
          ? blockById.get(table.persists.block)?.aggregate.id
          : undefined);
      if (aggregateId) {
        const list = tablesByAggregate.get(aggregateId) ?? [];
        list.push(table);
        tablesByAggregate.set(aggregateId, list);
      }
      const aggregate = aggregateId
        ? aggregateById.get(aggregateId)
        : undefined;

      for (const column of table.columns) {
        const owner: ColumnOwner = { column, table, store };
        columnById.set(columnId(table.id, column.name), owner);
        recordLineage(columnId(table.id, column.name), column);
        if (column.fk) {
          const into = fkIntoTable.get(column.fk.table) ?? [];
          into.push(owner);
          fkIntoTable.set(column.fk.table, into);
        }
        // `persists.block` names the block outright; otherwise the head of the
        // maps path is resolved inside the aggregate the table persists.
        const blockId =
          table.persists?.block ?? mapsBlockId(aggregate, column.maps);
        if (blockId && column.maps) {
          const list = columnsByBlock.get(blockId) ?? [];
          list.push(owner);
          columnsByBlock.set(blockId, list);
        }
      }
    }

    // Views after the tables of the same store: a view reads tables, and the
    // ones it reads are usually its neighbours in the same file.
    for (const view of storeViews(store)) {
      viewById.set(view.id, { view, store });
      const aggregateId =
        view.persists?.aggregate ??
        (view.persists?.block
          ? blockById.get(view.persists.block)?.aggregate.id
          : undefined);
      if (aggregateId) {
        const list = viewsByAggregate.get(aggregateId) ?? [];
        list.push(view);
        viewsByAggregate.set(aggregateId, list);
      }
      for (const readId of viewReads(view)) {
        const list = viewsReading.get(readId) ?? [];
        if (!list.includes(view)) list.push(view);
        viewsReading.set(readId, list);
      }
      for (const column of view.columns) {
        const id = columnId(view.id, column.name);
        viewColumnById.set(id, { column, view, store });
        recordLineage(id, column);
      }
    }
  }

  for (const flow of catalog.flows) {
    flowBySlug.set(flow.slug, flow);
    for (const step of walkSteps(flow.steps)) {
      if (step.ref && eventById.has(step.ref)) {
        const list = flowsByEvent.get(step.ref) ?? [];
        if (!list.includes(flow.slug)) list.push(flow.slug);
        flowsByEvent.set(step.ref, list);
      }
    }
  }

  for (const adr of [...catalog.adrs].sort(byDateDesc)) {
    adrById.set(adr.id, adr);
    adrBySlug.set(adr.slug, adr);
    for (const eventId of adr.relates.events ?? []) {
      const list = adrsByEvent.get(eventId) ?? [];
      list.push(adr);
      adrsByEvent.set(eventId, list);
    }
  }

  for (const term of allTerms(catalog)) {
    termById.set(term.id, term);
    const list = termsByContext.get(term.context) ?? [];
    list.push(term);
    termsByContext.set(term.context, list);
  }

  return {
    catalog,
    serviceById,
    serviceContext,
    aggregateById,
    aggregateOwner,
    eventById,
    eventOwner,
    eventByWireName,
    blockById,
    enumById,
    blocksByDef,
    rpcById,
    rpcProviderByMethod,
    externalById,
    externalProviderByMethod,
    flowBySlug,
    flowsByEvent,
    adrById,
    adrBySlug,
    adrsByEvent,
    termById,
    termsByContext,
    storeById,
    tableById,
    viewById,
    columnById,
    viewColumnById,
    viewsReading,
    lineageFrom,
    lineageInto,
    storesOwnedBy,
    deploymentsByService,
    moduleById,
    moduleBySlug,
    interfacesByModule,
    servicesUsingModule,
    tablesByAggregate,
    viewsByAggregate,
    keyspacesByAggregate,
    columnsByBlock,
    fkIntoTable,
  };
}

/** Newest decision first; ties broken by number so the order is total. */
export function byDateDesc(a: Adr, b: Adr): number {
  return b.date.localeCompare(a.date) || b.number - a.number;
}
