// What a rule sees: one row per subject, flat and typed.
//
// A rule is a predicate over one row, and a row cannot see the row next to
// it. So everything a rule would have to look up - who else writes this
// table, who publishes on this channel, whether the peer of a call is in the
// estate, what the provider's copy of an interface says - is looked up here,
// once, and written onto the row as a field. The joins are code; the
// judgement is CEL. That split is the whole design (portolan.0017): a
// projection says what is, and never whether it is wrong.
//
// Every field is a string, an int, a bool or a list of strings, so that the
// same row reads the same under Node and in the browser, and so the schema
// in problem-rules-cel.mjs can say exactly what an expression may name.

import type {
  Aggregate,
  Catalog,
  CatalogIndex,
  Channel,
  ChannelMessage,
  Column,
  Deployment,
  Event,
  Flow,
  RpcEnum,
  RpcMessage,
  RpcMethod,
  RpcService,
  Service,
  Store,
  Table,
  View,
} from "../catalog";
import {
  aggregateBlocks,
  allDeployments,
  blockFields,
  deploys,
  enumsOf,
  mapsFieldPath,
  relationOfColumnId,
  storeViews,
  viewReads,
  walkSteps,
} from "../catalog";
import { payloadColumn, typesDisagree } from "./data-model";
import { driftLines } from "./deployment-drift";
import type { RuleSubject } from "./problem-rules-cel.mjs";

/** One row a rule is asked about, with what a problem needs to know of it. */
export interface Subject {
  /** What the row is shown as, and where its near end links. */
  id: string;
  context: string;
  service: string;
  source: string | undefined;
  /** What the expression sees, under the subject's name. */
  row: Record<string, unknown>;
}

const int = (n: number) => BigInt(n);
const unique = (values: string[]) => [...new Set(values)];

function contextOf(index: CatalogIndex, service: Service | string | undefined): string {
  const id = typeof service === "string" ? service : service?.id;
  return id ? index.serviceContext.get(id)?.id ?? "" : "";
}

/** Every service with the context it sits in, in catalog order. */
function servicesOf(catalog: Catalog): { context: string; service: Service }[] {
  return catalog.contexts.flatMap((context) => context.services.map((service) => ({ context: context.id, service })));
}

/** Every row of one subject kind in the catalog, in catalog order. */
export function subjectsOf(catalog: Catalog, index: CatalogIndex, over: RuleSubject): Subject[] {
  switch (over) {
    case "service":
      return serviceSubjects(catalog);
    case "event":
      return eventSubjects(catalog);
    case "consumer":
      return consumerSubjects(catalog);
    case "channel":
      return channelSubjects(catalog);
    case "subscription":
      return subscriptionSubjects(catalog, index);
    case "table":
      return tableSubjects(catalog, index);
    case "column":
      return columnSubjects(catalog, index);
    case "deployment":
      return deploymentSubjects(catalog);
    case "flow":
      return catalog.flows.map((flow) => flowSubject(catalog, flow));
    case "aggregate":
      return servicesOf(catalog).flatMap(({ service }) => service.aggregates.map((aggregate) => aggregateSubject(catalog, index, aggregate)));
    case "call":
      return callSubjects(catalog, index);
    case "copy":
      return copySubjects(catalog, index);
  }
}

/** The names the estate answers to, for `x in estate.services`. */
export function estateOf(catalog: Catalog): Record<string, string[]> {
  const services = catalog.contexts.flatMap((context) => context.services);
  return {
    services: services.map((service) => service.id),
    contexts: catalog.contexts.map((context) => context.id),
    stores: (catalog.stores ?? []).map((store) => store.id),
    channels: unique(services.flatMap((service) => (service.channels ?? []).map((channel) => channel.address))),
    externals: (catalog.externals ?? []).map((external) => external.id),
  };
}

// ---------------------------------------------------------------------------
// Services and calls.

function serviceSubjects(catalog: Catalog): Subject[] {
  return servicesOf(catalog).map(({ context, service }) => ({
    id: service.id,
    context,
    service: service.id,
    source: undefined,
    row: {
      id: service.id,
      slug: service.slug,
      name: service.name,
      context,
      kind: service.kind ?? "service",
      repo: service.repo,
      path: service.path,
      technologies: service.technologies ?? [],
      owners: service.owners ?? [],
      provides: int(service.provides.length),
      methods: int(service.provides.reduce((n, provided) => n + provided.methods.length, 0)),
      calls: int(service.consumes.length),
      unresolvedCalls: int(service.consumes.filter((call) => call.status === "unresolved").length),
      aggregates: int(service.aggregates.length),
      events: int(service.aggregates.reduce((n, aggregate) => n + aggregate.events.length, 0)),
      stores: service.stores ?? [],
      channels: (service.channels ?? []).map((channel) => channel.address),
      hosts: service.hosts ?? [],
      dials: service.dials ?? [],
    },
  }));
}

function callSubjects(catalog: Catalog, index: CatalogIndex): Subject[] {
  return servicesOf(catalog).flatMap(({ context, service }) =>
    service.consumes.map((call) => {
      const slash = call.id.lastIndexOf("/");
      return {
        id: call.id,
        context,
        service: service.id,
        source: call.source,
        row: {
          id: call.id,
          interface: slash >= 0 ? call.id.slice(0, slash) : call.id,
          method: slash >= 0 ? call.id.slice(slash + 1) : "",
          peer: call.peer,
          status: call.status,
          resolved: call.status !== "unresolved",
          // The peer is a service of the estate, as opposed to an external
          // or a name nobody answers to; and the peer answers on the method.
          peerKnown: index.serviceById.has(call.peer),
          methodDeclared: index.rpcProviderByMethod.has(call.id),
          service: service.id,
          context,
          source: call.source,
          module: call.module ?? "",
          note: call.note ?? "",
        },
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// A vendored copy of an interface, held against what the provider publishes.

function copySubjects(catalog: Catalog, index: CatalogIndex): Subject[] {
  return servicesOf(catalog).flatMap(({ context, service }) =>
    (service.copies ?? []).map((copy) => {
      const provider = providerOf(service, copy, index);
      return {
        id: copy.id,
        context,
        service: service.id,
        source: copy.source,
        row: {
          id: copy.id,
          service: service.id,
          context,
          provider: provider?.service.id ?? "",
          methods: int(copy.methods.length),
          differences: provider ? compareInterfaces(copy, provider.interface) : [],
          source: copy.source ?? "",
        },
      };
    }),
  );
}

/** The provider a copy is compared against: the peer of a resolved call on one of its methods, when that peer publishes the interface. */
function providerOf(consumer: Service, copy: RpcService, index: CatalogIndex): { service: Service; interface: RpcService } | undefined {
  const calls = new Map(consumer.consumes.filter((call) => call.id.startsWith(`${copy.id}/`)).map((call) => [call.id, call]));
  const resolved = copy.methods
    .map((method) => calls.get(`${copy.id}/${method.name}`))
    .find((call) => call?.status !== "unresolved" && index.serviceById.has(call?.peer ?? ""));
  if (!resolved) return undefined;
  const service = index.serviceById.get(resolved.peer);
  const provided = service?.provides.find((candidate) => candidate.id === copy.id);
  return service && provided ? { service, interface: provided } : undefined;
}

/**
 * Every way a narrowed copy disagrees with the provider's interface. A method
 * the provider lacks is not listed: that is the `proto-missing` row, and a
 * stronger one. A field the copy omits is not a difference either - a
 * narrowed copy may leave out what it does not read - but every field it
 * carries must have the provider's type and number, and an enum must match
 * whole, because names and numbers are both wire claims.
 */
export function compareInterfaces(copy: RpcService, provider: RpcService): string[] {
  const out: string[] = [];
  const methods = new Map(provider.methods.map((method) => [method.name, method]));
  for (const method of copy.methods) {
    const actual = methods.get(method.name);
    if (actual) compareMethod(method, actual, out);
  }
  const messages = new Map((provider.messages ?? []).map((message) => [message.name, message]));
  for (const message of copy.messages ?? []) compareMessage(message, messages.get(message.name), out);
  const enums = new Map((provider.enums ?? []).map((item) => [item.name, item]));
  for (const item of copy.enums ?? []) compareEnum(item, enums.get(item.name), out);
  return out;
}

function compareMethod(copy: RpcMethod, provider: RpcMethod, out: string[]): void {
  for (const side of ["request", "response"] as const) {
    if (copy[side] !== provider[side]) {
      out.push(`${copy.name} ${side} is ${copy[side] || "unnamed"}, provider has ${provider[side] || "unnamed"}`);
    }
  }
  if (copy.streaming !== provider.streaming) {
    out.push(`${copy.name} streaming is ${copy.streaming ?? "unary"}, provider has ${provider.streaming ?? "unary"}`);
  }
}

function compareMessage(copy: RpcMessage, provider: RpcMessage | undefined, out: string[]): void {
  if (!provider) {
    out.push(`message ${copy.name} is absent from the provider`);
    return;
  }
  const fields = new Map(provider.fields.map((field) => [field.name, field]));
  for (const field of copy.fields) {
    const actual = fields.get(field.name);
    if (!actual) {
      out.push(`${copy.name}.${field.name} is absent from the provider`);
      continue;
    }
    if (field.type !== actual.type) out.push(`${copy.name}.${field.name} is ${field.type}, provider has ${actual.type}`);
    if (field.number !== undefined && actual.number !== undefined && field.number !== actual.number) {
      out.push(`${copy.name}.${field.name} is field ${field.number}, provider has ${actual.number}`);
    }
  }
}

function compareEnum(copy: RpcEnum, provider: RpcEnum | undefined, out: string[]): void {
  if (!provider) {
    out.push(`enum ${copy.name} is absent from the provider`);
    return;
  }
  const copyByName = new Map(copy.values.map((value) => [value.name, value]));
  const providerByName = new Map(provider.values.map((value) => [value.name, value]));
  for (const value of copy.values) {
    const actual = providerByName.get(value.name);
    if (!actual) out.push(`${copy.name}.${value.name} is absent from the provider`);
    else if (value.number !== actual.number) out.push(`${copy.name}.${value.name} is ${value.number}, provider has ${actual.number}`);
  }
  for (const value of provider.values) {
    if (!copyByName.has(value.name)) out.push(`${copy.name}.${value.name} is missing from the copy`);
  }
}

// ---------------------------------------------------------------------------
// Events, their consumers, and the bus.

/** The channels a service's document declares it sends domain events on. */
function declaredSends(service: Service): string[] {
  return (service.channels ?? [])
    .filter((channel) => (!channel.kind || channel.kind === "event") && channel.messages.some((message) => message.direction === "send"))
    .map((channel) => channel.address);
}

function eventSubjects(catalog: Catalog): Subject[] {
  return servicesOf(catalog).flatMap(({ context, service }) => {
    const declaredChannels = declaredSends(service);
    return service.aggregates.flatMap((aggregate) =>
      aggregate.events.map((event): Subject => {
        const latest = event.versions[event.versions.length - 1];
        return {
          id: event.id,
          context,
          service: service.id,
          source: event.versions[0]?.source,
          row: {
            id: event.id,
            slug: event.slug,
            name: event.name,
            aggregate: aggregate.id,
            service: service.id,
            context,
            versions: int(event.versions.length),
            deprecated: latest?.deprecated === true,
            consumers: event.consumers.map((consumer) => consumer.service),
            unresolvedConsumers: int(event.consumers.filter((consumer) => consumer.status === "unresolved").length),
            wireName: event.wire?.name ?? "",
            channel: event.wire?.channel ?? "",
            declaredChannels,
            fields: latest?.fields.map((field) => field.name) ?? [],
          },
        };
      }),
    );
  });
}

/** One row per consumer an event names: the edge, from the publisher's side. */
function consumerSubjects(catalog: Catalog): Subject[] {
  return servicesOf(catalog).flatMap(({ context, service }) =>
    service.aggregates.flatMap((aggregate) =>
      aggregate.events.flatMap((event) =>
        event.consumers.map(
          (consumer): Subject => ({
            id: event.id,
            context,
            service: service.id,
            source: undefined,
            row: {
              event: event.id,
              name: event.name,
              aggregate: aggregate.id,
              owner: service.id,
              context,
              consumer: consumer.service,
              status: consumer.status,
              resolved: consumer.status !== "unresolved",
              note: consumer.note ?? "",
            },
          }),
        ),
      ),
    ),
  );
}

interface Publishing {
  service: Service;
  context: string;
  events: Event[];
  declared: Channel | undefined;
}

/** What a publisher is putting on a channel, as the catalog knows it. */
function claimOf(publishing: Publishing): string {
  if (publishing.events.length > 0) return publishing.events.map((event) => event.name).join(", ");
  const sends = publishing.declared?.messages.filter((message) => message.direction === "send").map((message) => message.name) ?? [];
  return sends.length > 0 ? sends.join(", ") : "nothing the catalog can name";
}

/**
 * One row per service per channel it touches: the channels its document
 * declares and the ones its events name on the wire, as one list. A row
 * knows who else publishes on the address, because that is the one fact a
 * subscriber cannot see and a rule about sharing needs.
 */
function channelSubjects(catalog: Catalog): Subject[] {
  const rows: { address: string; publishing: Publishing }[] = [];
  const byAddress = new Map<string, Publishing[]>();
  for (const { context, service } of servicesOf(catalog)) {
    const mine = new Map<string, Publishing>();
    const at = (address: string): Publishing => {
      let entry = mine.get(address);
      if (!entry) {
        entry = { service, context, events: [], declared: undefined };
        mine.set(address, entry);
        rows.push({ address, publishing: entry });
        const all = byAddress.get(address) ?? [];
        all.push(entry);
        byAddress.set(address, all);
      }
      return entry;
    };
    for (const aggregate of service.aggregates) {
      for (const event of aggregate.events) if (event.wire?.channel) at(event.wire.channel).events.push(event);
    }
    for (const channel of service.channels ?? []) at(channel.address).declared = channel;
  }

  const publishes = (entry: Publishing): boolean => {
    if (entry.events.length > 0) return true;
    const channel = entry.declared;
    return Boolean(channel && (!channel.kind || channel.kind === "event") && channel.messages.some((message) => message.direction === "send"));
  };

  return rows.map(({ address, publishing }): Subject => {
    const channel = publishing.declared;
    const others = (byAddress.get(address) ?? []).filter((other) => other !== publishing && publishes(other));
    const first = publishing.events[0];
    const sends = channel?.messages.filter((message) => message.direction === "send").map((message) => message.name) ?? [];
    return {
      id: first?.id ?? publishing.service.id,
      context: publishing.context,
      service: publishing.service.id,
      source: first?.versions[0]?.source ?? channel?.source,
      row: {
        address,
        kind: channel?.kind ?? "event",
        title: channel?.title ?? "",
        service: publishing.service.id,
        context: publishing.context,
        declared: channel !== undefined,
        publishes: publishes(publishing),
        sends,
        receives: channel?.messages.filter((message) => message.direction === "receive").map((message) => message.name) ?? [],
        events: publishing.events.map((event) => event.id),
        otherPublishers: others.map((other) => other.service.id),
        otherClaims: others.map((other) => `${other.service.id}: ${claimOf(other)}`),
        source: channel?.source ?? "",
      },
    };
  });
}

function wireFormat(message: ChannelMessage): string {
  if (message.encoding) return message.encoding.trim().toLowerCase();
  const contentType = message.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType.includes("msgpack") || contentType.includes("messagepack")) return "msgpack";
  return contentType;
}

/**
 * One row per message a service's document says it receives, with who in
 * the estate puts that name on that channel - the one edge in the catalog
 * that runs from the subscriber outwards.
 */
function subscriptionSubjects(catalog: Catalog, index: CatalogIndex): Subject[] {
  interface Sender {
    service: Service;
    message: ChannelMessage;
  }
  const senders = new Map<string, Sender[]>();
  const published = new Set(index.eventByWireName.keys());
  for (const { service } of servicesOf(catalog)) {
    for (const channel of service.channels ?? []) {
      for (const message of channel.messages) {
        if (message.direction !== "send") continue;
        published.add(message.name);
        const key = `${channel.address} ${message.name}`;
        const list = senders.get(key) ?? [];
        list.push({ service, message });
        senders.set(key, list);
      }
    }
  }
  return servicesOf(catalog).flatMap(({ context, service }) =>
    (service.channels ?? []).flatMap((channel) =>
      channel.messages
        .filter((message) => message.direction === "receive")
        .map((message): Subject => {
          const expected = wireFormat(message);
          const sending = senders.get(`${channel.address} ${message.name}`) ?? [];
          const mismatched = expected ? sending.filter((sender) => wireFormat(sender.message) && wireFormat(sender.message) !== expected) : [];
          return {
            id: service.id,
            context,
            service: service.id,
            source: channel.source,
            row: {
              service: service.id,
              context,
              channel: channel.address,
              kind: channel.kind ?? "event",
              name: message.name,
              encoding: expected,
              published: published.has(message.name),
              publishers: sending.map((sender) => sender.service.id),
              mismatched: mismatched.map((sender) => sender.service.id),
              mismatchedEncodings: mismatched.map((sender) => wireFormat(sender.message)),
              source: channel.source ?? "",
            },
          };
        }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Where the aggregates live.

/** The fields an aggregate's blocks declare, first declaration of a name winning. */
function declaredFields(catalog: Catalog, aggregate: Aggregate | undefined): Map<string, string> {
  const fields = new Map<string, string>();
  if (!aggregate) return fields;
  for (const { block } of aggregateBlocks(aggregate)) {
    for (const field of blockFields(catalog, block)) if (!fields.has(field.name)) fields.set(field.name, field.type);
  }
  return fields;
}

function relationSubject(catalog: Catalog, index: CatalogIndex, store: Store, relation: Table | View, kind: "table" | "view"): Subject {
  const owner = index.serviceById.get(store.owner);
  const context = contextOf(index, owner);
  const aggregateId = relation.persists?.aggregate ?? "";
  const aggregate = aggregateId ? index.aggregateById.get(aggregateId) : undefined;
  const fields = declaredFields(catalog, aggregate);
  const table = kind === "table" ? (relation as Table) : undefined;
  const accesses = table?.accesses ?? [];
  const claimed = relation.columns.filter((column) => column.maps);
  const mapped = claimed.filter((column) => fields.has(mapsFieldPath(column.maps!).split(".")[0] ?? ""));
  const view = kind === "view" ? (relation as View) : undefined;
  const foreignReads = view
    ? viewReads(view).filter((readId) => {
        const target = index.tableById.get(readId) ?? index.viewById.get(readId);
        return target !== undefined && target.store.owner !== store.owner;
      })
    : [];
  return {
    id: relation.id,
    context,
    service: store.owner,
    source: view?.source ?? store.source,
    row: {
      id: relation.id,
      name: relation.name,
      kind,
      store: store.id,
      storeKind: store.kind,
      owner: store.owner,
      context,
      role: table?.role ?? "",
      aggregate: aggregateId,
      aggregateOwner: aggregateId ? index.aggregateOwner.get(aggregateId)?.id ?? "" : "",
      aggregateFields: int(fields.size),
      mappedColumns: int(mapped.length),
      claimedColumns: int(claimed.length),
      block: relation.persists?.block ?? "",
      columns: relation.columns.map((column) => column.name),
      primaryKey: relation.columns.filter((column) => column.pk).map((column) => column.name),
      foreignKeys: relation.columns.flatMap((column) => (column.fk ? [column.fk.table] : [])),
      foreignReads,
      hasPayload: table ? payloadColumn(table) !== null : false,
      indexes: int(table?.indexes?.length ?? 0),
      reads: int(accesses.filter((access) => access.operation === "read").length),
      writes: int(accesses.filter((access) => access.operation === "write").length),
      deletes: int(accesses.filter((access) => access.operation === "delete").length),
    },
  };
}

function tableSubjects(catalog: Catalog, index: CatalogIndex): Subject[] {
  return (catalog.stores ?? []).flatMap((store) => [
    ...store.tables.map((table) => relationSubject(catalog, index, store, table, "table")),
    ...storeViews(store).map((view) => relationSubject(catalog, index, store, view, "view")),
  ]);
}

function columnSubject(catalog: Catalog, index: CatalogIndex, store: Store, relation: Table | View, kind: "table" | "view", column: Column): Subject {
  const owner = index.serviceById.get(store.owner);
  const context = contextOf(index, owner);
  const fkTarget = column.fk ? index.tableById.get(column.fk.table) : undefined;
  const from = column.from ?? [];
  const foreignFrom = unique(
    from.filter((ref) => {
      const target = index.tableById.get(relationOfColumnId(ref)) ?? index.viewById.get(relationOfColumnId(ref));
      return target !== undefined && target.store.owner !== store.owner;
    }),
  );
  const aggregateId = relation.persists?.aggregate;
  const fields = declaredFields(catalog, aggregateId ? index.aggregateById.get(aggregateId) : undefined);
  const fieldType = column.maps ? fields.get(mapsFieldPath(column.maps).split(".")[0] ?? "") ?? "" : "";
  return {
    id: `${relation.id}.${column.name}`,
    context,
    service: store.owner,
    source: store.source,
    row: {
      id: `${relation.id}.${column.name}`,
      name: column.name,
      relation: relation.id,
      kind,
      store: store.id,
      owner: store.owner,
      context,
      type: column.type,
      nullable: column.nullable,
      pk: column.pk === true,
      fk: column.fk?.table ?? "",
      fkOwner: fkTarget?.store.owner ?? "",
      from,
      foreignFrom,
      foreignOwners: unique(
        foreignFrom.map((ref) => (index.tableById.get(relationOfColumnId(ref)) ?? index.viewById.get(relationOfColumnId(ref)))?.store.owner ?? ""),
      ),
      maps: column.maps ?? "",
      fieldType,
      typeMatches: !fieldType || !typesDisagree(column.type, fieldType),
    },
  };
}

function columnSubjects(catalog: Catalog, index: CatalogIndex): Subject[] {
  return (catalog.stores ?? []).flatMap((store) => [
    ...store.tables.flatMap((table) => table.columns.map((column) => columnSubject(catalog, index, store, table, "table", column))),
    ...storeViews(store).flatMap((view) => view.columns.map((column) => columnSubject(catalog, index, store, view, "view", column))),
  ]);
}

// ---------------------------------------------------------------------------
// Where the services run.

/** Where the Application deploys from, as a row's far end: the thing nobody claims. */
function deployedFrom(deployment: Deployment): string {
  if (deployment.chart && !deployment.path) return `chart ${deployment.chart}`;
  return [deployment.repo, deployment.path].filter(Boolean).join("/") || "?";
}

function deploymentSubjects(catalog: Catalog): Subject[] {
  const services = servicesOf(catalog);
  return allDeployments(catalog).map((deployment): Subject => {
    const owner = services.find(({ service }) => deploys(deployment, service));
    return {
      id: deployment.id,
      context: owner?.context ?? "",
      service: owner?.service.id ?? "",
      source: undefined,
      row: {
        id: deployment.id,
        name: deployment.name,
        project: deployment.project,
        environment: deployment.environment,
        cluster: deployment.cluster,
        namespace: deployment.namespace,
        repo: deployment.repo,
        path: deployment.path,
        chart: deployment.chart ?? "",
        from: deployedFrom(deployment),
        targetRevision: deployment.targetRevision,
        revision: deployment.revision,
        tool: deployment.tool,
        service: owner?.service.id ?? "",
        labelled: deployment.service ?? "",
        claimed: owner !== undefined,
        context: owner?.context ?? "",
        runsIn: deployment.environment || deployment.cluster || "an unnamed environment",
        images: deployment.images ?? [],
        basis: deployment.basis ?? "api",
        drifted: driftLines(deployment).length > 0,
        drift: driftLines(deployment).join("; "),
        url: deployment.url,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Flows and aggregates.

function flowSubject(catalog: Catalog, flow: Flow): Subject {
  const steps = walkSteps(flow.steps);
  const participants = flow.participants.filter((participant) => participant.kind === "service").map((participant) => participant.id);
  const contexts = unique(flow.participants.flatMap((participant) => (participant.context ? [participant.context] : [])));
  // The near end of a flow's row is the service that owns its first lane,
  // which is where the flow's page says it starts; the owner is a context.
  const first = participants[0] ?? "";
  return {
    id: flow.id,
    context: flow.owner,
    service: catalog.contexts.some((context) => context.services.some((service) => service.id === first)) ? first : "",
    source: flow.source,
    row: {
      id: flow.id,
      slug: flow.slug,
      name: flow.name,
      owner: flow.owner,
      trigger: flow.trigger?.kind ?? "",
      triggerConfidence: flow.trigger?.confidence ?? "",
      participants,
      contexts,
      crossContext: contexts.length > 1,
      steps: int(steps.length),
      verifiedSteps: int(steps.filter((step) => step.status === "verified").length),
      declaredSteps: int(steps.filter((step) => step.status === "declared").length),
      unresolvedSteps: int(steps.filter((step) => step.status === "unresolved").length),
      seenSteps: int(steps.filter((step) => step.seen !== undefined).length),
      events: unique(steps.filter((step) => step.kind === "event" && step.ref).map((step) => step.ref!)),
      stores: unique(steps.flatMap((step) => (step.storeAccess ? [step.storeAccess.store] : []))),
      examples: int(flow.examples?.length ?? 0),
      source: flow.source ?? "",
    },
  };
}

function aggregateSubject(catalog: Catalog, index: CatalogIndex, aggregate: Aggregate): Subject {
  const owner = index.aggregateOwner.get(aggregate.id);
  const tables = (catalog.stores ?? []).flatMap((store) =>
    store.tables.filter((table) => table.persists?.aggregate === aggregate.id).map((table) => table.id),
  );
  return {
    id: aggregate.id,
    context: contextOf(index, owner),
    service: owner?.id ?? "",
    source: undefined,
    row: {
      id: aggregate.id,
      slug: aggregate.slug,
      name: aggregate.name,
      root: aggregate.root,
      modelGroup: aggregate.kind === "model-group",
      service: owner?.id ?? "",
      context: contextOf(index, owner),
      entities: int(aggregate.entities.length),
      valueObjects: int(aggregate.valueObjects.length),
      enums: int(enumsOf(aggregate).length),
      commands: int(aggregate.operations.filter((operation) => operation.kind === "command").length),
      queries: int(aggregate.operations.filter((operation) => operation.kind === "query").length),
      exposedOperations: int(aggregate.operations.filter((operation) => (operation.exposedBy?.length ?? 0) > 0).length),
      deprecatedOperations: int(aggregate.operations.filter((operation) => operation.deprecated).length),
      events: aggregate.events.map((event) => event.id),
      states: aggregate.lifecycle?.states ?? [],
      transitions: int(aggregate.lifecycle?.transitions.length ?? 0),
      tables,
    },
  };
}
