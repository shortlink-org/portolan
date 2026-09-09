import type {
  Adr,
  Aggregate,
  Catalog,
  Flow,
  FlowNode,
  FlowTrigger,
  Lifecycle,
  Service,
  Step,
} from "./catalog-model.ts";
import {
  CLASSIFICATIONS,
  COMPONENT_KINDS,
  GROUP_KINDS,
  REDIS_OPERATIONS,
  STORE_KINDS,
  STREAMING,
  TABLE_ROLES,
  aggregateBlocks,
  allAggregates,
  allExternals,
  allModules,
  allRepos,
  allServices,
  allStores,
  allTerms,
  columnNameOfId,
  enumsOf,
  relationOfColumnId,
  rootEntity,
  storeViews,
  walkSteps,
} from "./catalog-model.ts";

// ---------------------------------------------------------------------------
// Validation. Throws on the first violation with a message that names the
// offending flow / step / field, so a bad generator run fails loudly.
// ---------------------------------------------------------------------------

export class CatalogError extends Error {
  /**
   * Where the violation is, as a reader would name it: "flow checkout-happy /
   * step s4", "aggregate shop.oms.order". The message already says what is
   * wrong; this says which line of the generator run to go and look at, and it
   * is what the error page prints under the message.
   */
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "CatalogError";
    this.path = path;
  }
}

function fail(message: string, path?: string): never {
  throw new CatalogError(message, path);
}

function assertUniqueSlugs(
  slugs: string[],
  parent: string,
  what: string,
): void {
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug))
      fail(`${what} slug "${slug}" is not unique within ${parent}`, parent);
    seen.add(slug);
  }
}

/**
 * What a service says about the bus.
 *
 * The address is the whole of a channel's identity - there is no id, because a
 * channel is not a page and nothing links to one - so two channels sharing an
 * address in one service is the same mistake as two aggregates sharing a slug.
 * A message with no name is worse than no message at all: the name is what an
 * event's wire is compared against, and a blank one matches everything.
 */
function validateChannels(service: Service): void {
  const addresses = new Set<string>();

  for (const channel of service.channels ?? []) {
    if (typeof channel.address !== "string" || channel.address === "") {
      fail(
        `service "${service.id}" declares a channel with no address; the address is what a channel is`,
        `service ${service.id}`,
      );
    }
    if (addresses.has(channel.address)) {
      fail(
        `service "${service.id}" declares channel "${channel.address}" twice; one channel says both directions`,
        `service ${service.id}`,
      );
    }
    addresses.add(channel.address);

    if (
      channel.kind !== undefined &&
      channel.kind !== "event" &&
      channel.kind !== "job" &&
      channel.kind !== "message"
    ) {
      fail(
        `channel "${channel.address}" of service "${service.id}" has kind "${channel.kind}", which is neither event, job, nor message`,
        `service ${service.id} / channel ${channel.address}`,
      );
    }

    const seen = new Set<string>();
    for (const message of channel.messages) {
      if (typeof message.name !== "string" || message.name === "") {
        fail(
          `channel "${channel.address}" of service "${service.id}" carries a message with no name; the name is what a subscriber dispatches on`,
          `service ${service.id} / channel ${channel.address}`,
        );
      }
      if (message.direction !== "send" && message.direction !== "receive") {
        fail(
          `message "${message.name}" on channel "${channel.address}" travels "${message.direction}", which is neither send nor receive`,
          `service ${service.id} / channel ${channel.address}`,
        );
      }
      const key = `${message.direction} ${message.name}`;
      if (seen.has(key)) {
        fail(
          `channel "${channel.address}" of service "${service.id}" declares "${message.name}" twice in the same direction`,
          `service ${service.id} / channel ${channel.address}`,
        );
      }
      seen.add(key);
    }
  }
}

export function validateCatalog(catalog: Catalog): Catalog {
  if (!catalog.generatedAt) fail("catalog.generatedAt is missing", "catalog");
  if (!catalog.commit) fail("catalog.commit is missing", "catalog");

  const eventIds = new Set<string>();
  const rpcIds = new Set<string>();
  const providedRpcRefs = new Set(
    allExternals(catalog).flatMap((external) =>
      external.provides.flatMap((provided) =>
        provided.methods.map(
          (method) => `${external.id}|${provided.id}/${method.name}`,
        ),
      ),
    ),
  );
  const storeIds = new Set(allStores(catalog).map((store) => store.id));

  assertUniqueSlugs(
    catalog.contexts.map((c) => c.id),
    "catalog",
    "context",
  );

  for (const context of catalog.contexts) {
    // A context is a root, so it has nothing to be a slug relative to: id and
    // slug are the same string, and holding them equal here keeps every route
    // built from `context.id` addressing the same thing the slug names.
    if (context.slug !== context.id) {
      fail(
        `context "${context.id}" has slug "${context.slug}"; a context sits at the root, so its slug must equal its id`,
        `context ${context.id}`,
      );
    }
    if (context.kind !== undefined && !GROUP_KINDS.includes(context.kind)) {
      fail(
        `context "${context.id}" has kind "${context.kind}"; expected one of ${GROUP_KINDS.join(", ")}`,
        `context ${context.id}`,
      );
    }
    if (
      context.classification !== undefined &&
      !CLASSIFICATIONS.includes(context.classification)
    ) {
      fail(
        `context "${context.id}" has classification "${context.classification}"; expected one of ${CLASSIFICATIONS.join(", ")}`,
        `context ${context.id}`,
      );
    }
    assertUniqueSlugs(
      context.services.map((s) => s.slug),
      `context "${context.id}"`,
      "service",
    );
    for (const service of context.services) {
      if (service.id !== `${context.id}.${service.slug}`) {
        fail(
          `service "${service.id}" in context "${context.id}" must have id "${context.id}.${service.slug}"`,
          `service ${service.id}`,
        );
      }
      if (
        service.kind !== undefined &&
        !COMPONENT_KINDS.includes(service.kind)
      ) {
        fail(
          `service "${service.id}" has kind "${service.kind}"; expected one of ${COMPONENT_KINDS.join(", ")}`,
          `service ${service.id}`,
        );
      }
      // Owners are opaque - the estate's business is who to ask, not what a
      // handle resolves to - so only the two things that would render as a
      // hole are checked: a blank chip, and one name shown twice.
      const handles = new Set<string>();
      for (const handle of service.owners ?? []) {
        if (!handle.trim()) {
          fail(
            `service "${service.id}" has an owner with no name`,
            `service ${service.id}`,
          );
        }
        if (handles.has(handle)) {
          fail(
            `service "${service.id}" names owner "${handle}" twice`,
            `service ${service.id}`,
          );
        }
        handles.add(handle);
      }
      const technologies = new Set<string>();
      for (const technology of service.technologies ?? []) {
        if (!technology.trim()) {
          fail(
            `service "${service.id}" has a technology with no name`,
            `service ${service.id}`,
          );
        }
        if (technologies.has(technology)) {
          fail(
            `service "${service.id}" names technology "${technology}" twice`,
            `service ${service.id}`,
          );
        }
        technologies.add(technology);
      }
      for (const call of service.consumes) rpcIds.add(call.id);
      for (const provided of service.provides) {
        for (const method of provided.methods) {
          providedRpcRefs.add(
            `${service.id}|${provided.id}/${method.name}`,
          );
        }
      }
      for (const provided of [
        ...service.provides,
        ...(service.copies ?? []),
      ]) {
        // A duplicate method name is not a cosmetic problem: `exposedBy` names
        // a method by name alone, and `rpcProviderByMethod` is keyed by it, so
        // two methods called the same thing make one of them unreachable.
        assertUniqueSlugs(
          provided.methods.map((method) => method.name),
          `interface "${provided.id}"`,
          "method",
        );
        for (const method of provided.methods) {
          if (
            method.streaming !== undefined &&
            !STREAMING.includes(method.streaming)
          ) {
            fail(
              `method "${provided.id}/${method.name}" streams "${method.streaming}"; expected one of ${STREAMING.join(", ")}`,
              `service ${service.id}`,
            );
          }
          if (
            method.soap?.version !== undefined &&
            method.soap.version !== "1.1" &&
            method.soap.version !== "1.2"
          ) {
            fail(
              `method "${provided.id}/${method.name}" uses SOAP ${method.soap.version}; expected 1.1 or 1.2`,
              `service ${service.id}`,
            );
          }
        }
        const messageNames = new Set(
          (provided.messages ?? []).map((message) => message.name),
        );
        for (const message of provided.messages ?? []) {
          if (message.discriminator !== undefined) {
            const discriminator = message.discriminator;
            if (discriminator.property === "") {
              fail(
                `rpc message "${provided.id}.${message.name}" has an empty discriminator property`,
                `service ${service.id} / rpc ${provided.id}.${message.name}`,
              );
            }
            const values = new Set<string>();
            for (const variant of discriminator.variants) {
              if (variant.value === "" || variant.message === "") {
                fail(
                  `rpc message "${provided.id}.${message.name}" has an incomplete discriminator variant`,
                  `service ${service.id} / rpc ${provided.id}.${message.name}`,
                );
              }
              if (values.has(variant.value)) {
                fail(
                  `rpc message "${provided.id}.${message.name}" maps discriminator value "${variant.value}" more than once`,
                  `service ${service.id} / rpc ${provided.id}.${message.name}`,
                );
              }
              values.add(variant.value);
              if (!messageNames.has(variant.message)) {
                fail(
                  `rpc message "${provided.id}.${message.name}" discriminator references unknown message "${variant.message}"`,
                  `service ${service.id} / rpc ${provided.id}.${message.name}`,
                );
              }
            }
          }
          for (const field of message.fields) {
            if (field.ref !== undefined && !(field.ref in catalog.defs)) {
              fail(
                `field "${field.name}" of rpc message "${provided.id}.${message.name}" references unknown def "${field.ref}"`,
                `service ${service.id} / rpc ${provided.id}.${message.name} / field ${field.name}`,
              );
            }
          }
        }
      }

      // Every method this service answers on, whichever interface declares it.
      // An operation says which of them expose it, and a name that matches none
      // of them is a link into nothing.
      const methods = new Set(
        service.provides.flatMap((provided) =>
          provided.methods.map((method) => method.name),
        ),
      );

      validateChannels(service);

      assertUniqueSlugs(
        service.aggregates.map((a) => a.slug),
        `service "${service.id}"`,
        "aggregate",
      );
      for (const aggregate of service.aggregates) {
        for (const operation of aggregate.operations) {
          for (const method of operation.exposedBy ?? []) {
            if (!methods.has(method)) {
              fail(
                `operation "${operation.id}" of aggregate "${aggregate.id}" says it is exposed by "${method}", which no interface of service "${service.id}" declares`,
                `aggregate ${aggregate.id} / operation ${operation.id}`,
              );
            }
          }
        }
        validateBlocks(catalog, aggregate);
        assertUniqueSlugs(
          aggregate.events.map((e) => e.slug),
          `aggregate "${aggregate.id}"`,
          "event",
        );
        for (const event of aggregate.events) {
          if (event.versions.length === 0) {
            fail(
              `event "${event.id}" has no versions; at least one is required`,
              `event ${event.id}`,
            );
          }
          eventIds.add(event.id);
          if (event.wire !== undefined) {
            if (typeof event.wire.name !== "string" || event.wire.name === "") {
              fail(
                `event "${event.id}" has a wire with no name; the name on the message is what a wire is`,
                `event ${event.id}`,
              );
            }
            if (event.wire.channel !== undefined && event.wire.channel === "") {
              fail(
                `event "${event.id}" names an empty channel; leave it out when the source does not say`,
                `event ${event.id}`,
              );
            }
          }
          for (const version of event.versions) {
            for (const field of version.fields) {
              if (field.ref !== undefined && !(field.ref in catalog.defs)) {
                fail(
                  `field "${field.name}" of ${event.id}@${version.version} references unknown def "${field.ref}"`,
                  `event ${event.id}@${version.version} / field ${field.name}`,
                );
              }
            }
          }
        }
      }
    }
  }

  for (const [defId, def] of Object.entries(catalog.defs)) {
    for (const field of def.fields) {
      if (field.ref !== undefined && !(field.ref in catalog.defs)) {
        fail(
          `field "${field.name}" of def "${defId}" references unknown def "${field.ref}"`,
          `def ${defId} / field ${field.name}`,
        );
      }
    }
  }

  assertUniqueSlugs(
    catalog.flows.map((f) => f.slug),
    "catalog",
    "flow",
  );

  const flowGroupIds = new Set(catalog.contexts.map((c) => c.id));

  const triggerKinds = new Set<FlowTrigger["kind"]>([
    "http",
    "callback",
    "event",
    "message",
    "job",
    "startup",
    "scheduled",
    "manual",
    "unproven",
  ]);
  const triggerConfidence = new Set<FlowTrigger["confidence"]>([
    "high",
    "medium",
    "low",
  ]);

  for (const flow of catalog.flows) {
    const lanes = new Set(flow.participants.map((p) => p.id));
    if (lanes.size !== flow.participants.length) {
      fail(
        `flow "${flow.slug}" has duplicate participant ids`,
        `flow ${flow.id}`,
      );
    }
    // Whatever derived the flow knew which service's tree it was reading, so
    // there is no case where the owner is unknowable. Without it the flow has
    // no group to sit under and the tree files it as a defect.
    if (flow.owner === undefined) {
      fail(
        `flow "${flow.slug}" names no owner; a flow must state the group it belongs to`,
        `flow ${flow.id}`,
      );
    }
    if (flow.owner !== undefined && !flowGroupIds.has(flow.owner)) {
      fail(
        `flow "${flow.slug}" names owner "${flow.owner}", which is not a top-level group`,
        `flow ${flow.id}`,
      );
    }
    if (flow.trigger && !triggerKinds.has(flow.trigger.kind)) {
      fail(
        `flow "${flow.slug}" has unknown trigger kind "${flow.trigger.kind}"`,
        `flow ${flow.id}`,
      );
    }
    if (flow.trigger && !triggerConfidence.has(flow.trigger.confidence)) {
      fail(
        `flow "${flow.slug}" has unknown trigger confidence "${flow.trigger.confidence}"`,
        `flow ${flow.id}`,
      );
    }
    if (flow.includes) {
      const included = new Set<string>();
      for (const slug of flow.includes) {
        if (!slug || slug === flow.slug || included.has(slug)) {
          fail(
            `flow "${flow.slug}" has an invalid or duplicate included flow "${slug}"`,
            `flow ${flow.id}`,
          );
        }
        included.add(slug);
      }
    }
    validateFlowFrames(flow, flow.steps);

    const steps = walkSteps(flow.steps);
    const stepIds = new Set<string>();
    const stepById = new Map<string, Step>();
    for (const step of steps) {
      if (stepIds.has(step.id)) {
        fail(
          `flow "${flow.slug}" has duplicate step id "${step.id}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      stepIds.add(step.id);
      stepById.set(step.id, step);

      if (
        !(["rpc", "event", "call", "response"] as const).includes(step.kind)
      ) {
        fail(
          `flow "${flow.slug}" step "${step.id}" has unknown kind "${step.kind}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }

      if (step.reaches?.some((entrypoint) => entrypoint.length === 0)) {
        fail(
          `flow "${flow.slug}" step "${step.id}" has an empty reached source function`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.handoff) {
        if (!(["message", "job"] as const).includes(step.handoff.kind)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown handoff kind "${step.handoff.kind}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!step.handoff.transport) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a handoff with no transport`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!step.handoff.channel) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a handoff with no channel`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (step.handoff.kind === "job" && !step.handoff.message) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has a job handoff with no message`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!(["send", "receive"] as const).includes(step.handoff.direction)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown handoff direction "${step.handoff.direction}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
      if (step.storeAccess) {
        if (step.kind !== "call") {
          fail(
            `flow "${flow.slug}" step "${step.id}" has store access metadata but is not a call`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (!storeIds.has(step.storeAccess.store)) {
          fail(
            `flow "${flow.slug}" step "${step.id}" names unknown store "${step.storeAccess.store}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.storeAccess.operation !== undefined &&
          !REDIS_OPERATIONS.includes(step.storeAccess.operation)
        ) {
          fail(
            `flow "${flow.slug}" step "${step.id}" has unknown store operation "${step.storeAccess.operation}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
      if (step.http) {
        if (step.kind !== "response") {
          fail(
            `flow "${flow.slug}" step "${step.id}" has HTTP response metadata but is not a response`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.http.status !== undefined &&
          (step.http.status < 100 || step.http.status > 599)
        ) {
          fail(
            `flow "${flow.slug}" response "${step.id}" has invalid HTTP status ${step.http.status}`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        if (
          step.http.outcome !== undefined &&
          !(["success", "error"] as const).includes(step.http.outcome)
        ) {
          fail(
            `flow "${flow.slug}" response "${step.id}" has unknown HTTP outcome "${step.http.outcome}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }

      if (!lanes.has(step.from)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": from "${step.from}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (!lanes.has(step.to)) {
        fail(
          `flow "${flow.slug}" step "${step.id}": to "${step.to}" is not a declared participant`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.ref !== undefined && step.status !== "unresolved") {
        const resolves =
          eventIds.has(step.ref) ||
          rpcIds.has(step.ref) ||
          (step.kind === "rpc" &&
            providedRpcRefs.has(`${step.to}|${step.ref}`));
        if (!resolves) {
          fail(
            `flow "${flow.slug}" step "${step.id}": ref "${step.ref}" resolves to neither an Event, an RpcCall nor a method provided by "${step.to}", and status is "${step.status}" rather than "unresolved"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
      }
    }

    for (const step of steps) {
      if (step.kind !== "response") {
        if (step.replyTo !== undefined) {
          fail(
            `flow "${flow.slug}" step "${step.id}" is not a response but names replyTo "${step.replyTo}"`,
            `flow ${flow.id} / step ${step.id}`,
          );
        }
        continue;
      }
      if (!step.replyTo) {
        fail(
          `flow "${flow.slug}" response "${step.id}" names no request in replyTo`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      const request = stepById.get(step.replyTo);
      if (!request || request.kind !== "rpc") {
        fail(
          `flow "${flow.slug}" response "${step.id}" replies to "${step.replyTo}", which is not an rpc request`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
      if (step.from !== request.to || step.to !== request.from) {
        fail(
          `flow "${flow.slug}" response "${step.id}" does not reverse request "${request.id}"`,
          `flow ${flow.id} / step ${step.id}`,
        );
      }
    }
  }

  validateExternals(catalog);
  validateStores(catalog);
  validateModules(catalog);
  validateAdrs(catalog, eventIds);
  validateTerms(catalog);
  validateRepos(catalog);

  return catalog;
}

/**
 * A module reference may only point at a module that exists.
 *
 * `deps` are the exception, and deliberately NOT checked. A module's
 * dependencies come from its own lock file and routinely name modules this
 * estate never vendored - the same kind of fact as an `RpcCall` to a peer
 * outside the catalog. Requiring them to resolve would mean a module could only
 * be recorded once everything it transitively depends on had been vendored too,
 * which is a rule about the estate's homework rather than about the catalog
 * being coherent. A dangling dep is shown as a name the catalog does not hold.
 *
 * Also NOT checked: whether a method's `request` names a message the interface
 * actually lists, and whether a module is pinned to a commit. Both are
 * legitimate mid-migration states - a copy vendored before the producer
 * published, a module tracked by label - and refusing to render the catalog
 * over either would be refusing to describe the estate as it is. They belong on
 * the Problems page, which is where the rest of that judgement already lives.
 */
function validateModules(catalog: Catalog): void {
  const modules = allModules(catalog);
  const ids = new Set(modules.map((m) => m.id));
  const serviceIds = new Set(allServices(catalog).map((s) => s.id));

  assertUniqueSlugs(
    modules.map((m) => m.id),
    "catalog",
    "module",
  );
  // Slugs are what the URL uses, so two modules sharing one would put two
  // entities at the same address.
  assertUniqueSlugs(
    modules.map((m) => m.slug),
    "catalog",
    "module slug",
  );

  for (const module of modules) {
    if (module.owner !== undefined && !serviceIds.has(module.owner)) {
      fail(
        `module "${module.id}" is owned by "${module.owner}", which is not a service in this catalog`,
        `module ${module.id}`,
      );
    }
  }

  const refers = (module: string, where: string, path: string) => {
    if (!ids.has(module)) {
      fail(
        `${where} names module "${module}", which is not in this catalog`,
        path,
      );
    }
  };

  for (const service of allServices(catalog)) {
    for (const module of service.modules ?? []) {
      refers(module, `service "${service.id}"`, `service ${service.id}`);
    }
    for (const provided of service.provides) {
      if (provided.module !== undefined) {
        refers(
          provided.module,
          `interface "${provided.id}"`,
          `service ${service.id}`,
        );
      }
    }
    for (const copy of service.copies ?? []) {
      if (copy.module !== undefined) {
        refers(
          copy.module,
          `vendored interface "${copy.id}"`,
          `service ${service.id}`,
        );
      }
    }
    for (const call of service.consumes) {
      if (call.module !== undefined) {
        refers(call.module, `call "${call.id}"`, `service ${service.id}`);
      }
    }
  }
}

/**
 * An external sits at the root beside the contexts, so it is held to the same
 * shape: id equal to slug, no dot, and a name nothing else at the root uses.
 * The last rule is the one that matters - a flow lane, a call's `peer` and a
 * LikeC4 node all address the root by a bare id, and an external called
 * `shop` beside a context called `shop` would land every arrow on the wrong one.
 *
 * What is NOT checked: whether any service calls it. An external nobody calls
 * is a copy vendored ahead of the adapter, which is a legitimate mid-migration
 * state and shows on its page as "called by nobody" rather than failing the
 * build.
 */
function validateExternals(catalog: Catalog): void {
  const externals = allExternals(catalog);
  if (externals.length === 0) return;

  assertUniqueSlugs(
    externals.map((e) => e.id),
    "catalog",
    "external",
  );
  const contextIds = new Set(catalog.contexts.map((c) => c.id));

  for (const external of externals) {
    if (external.slug !== external.id) {
      fail(
        `external "${external.id}" has slug "${external.slug}"; an external sits at the root, so its slug must equal its id`,
        `external ${external.id}`,
      );
    }
    if (external.id.includes(".")) {
      fail(
        `external "${external.id}" has a dot in its id; an external sits at the root and is addressed by a bare name`,
        `external ${external.id}`,
      );
    }
    if (contextIds.has(external.id)) {
      fail(
        `external "${external.id}" has the id of a bounded context; the root cannot hold both`,
        `external ${external.id}`,
      );
    }
    assertUniqueSlugs(
      external.provides.map((p) => p.id),
      `external "${external.id}"`,
      "interface",
    );
    for (const provided of external.provides) {
      assertUniqueSlugs(
        provided.methods.map((method) => method.name),
        `interface "${provided.id}"`,
        "method",
      );
      for (const method of provided.methods) {
        if (
          method.soap?.version !== undefined &&
          method.soap.version !== "1.1" &&
          method.soap.version !== "1.2"
        ) {
          fail(
            `method "${provided.id}/${method.name}" uses SOAP ${method.soap.version}; expected 1.1 or 1.2`,
            `external ${external.id}`,
          );
        }
      }
    }
  }
}

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
function validateStores(catalog: Catalog): void {
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

/**
 * Frames have to mean what they say. An alt with one branch is not a choice, an
 * untitled branch states no condition, and steps written after an alt whose
 * every branch is terminal can never run — each of those would be drawn as a
 * perfectly ordinary sequence, which is exactly the reading we are trying to
 * stop, so they fail the build instead.
 */
function validateFlowFrames(flow: Flow, nodes: FlowNode[]): void {
  nodes.forEach((node, i) => {
    switch (node.type) {
      case "step":
        break;
      case "parallel":
        for (const branch of node.branches) validateFlowFrames(flow, branch);
        break;
      case "loop":
        if (!node.title) {
          fail(
            `flow "${flow.slug}" loop "${node.id}" has no title, so the diagram cannot say what it repeats until`,
            `flow ${flow.id} / loop ${node.id}`,
          );
        }
        validateFlowFrames(flow, node.steps);
        break;
      case "alt": {
        if (node.branches.length < 2) {
          fail(
            `flow "${flow.slug}" alt "${node.id}" has ${node.branches.length} branch(es); an alt states a choice and needs at least two`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        const titles = new Set<string>();
        for (const branch of node.branches) {
          if (!branch.title) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has a branch with no title, so nothing says when it runs`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          if (titles.has(branch.title)) {
            fail(
              `flow "${flow.slug}" alt "${node.id}" has two branches titled "${branch.title}"`,
              `flow ${flow.id} / alt ${node.id}`,
            );
          }
          titles.add(branch.title);
          validateFlowFrames(flow, branch.steps);
        }
        if (node.branches.every((b) => b.terminal) && i < nodes.length - 1) {
          fail(
            `flow "${flow.slug}" alt "${node.id}": every branch is terminal, so the ${nodes.length - 1 - i} node(s) after it can never run`,
            `flow ${flow.id} / alt ${node.id}`,
          );
        }
        break;
      }
    }
  });
}

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

function validateBlocks(catalog: Catalog, aggregate: Aggregate): void {
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

/**
 * A term belongs to a context that exists, and its id says which one.
 *
 * The composition check is the one that earns its place. A glossary sits
 * beside a SERVICE and the words in it belong to a context, so the extractor
 * has to be told which - and told nothing, it falls back to the directory's
 * name. Left that way, `examples/shop/oms/GLOSSARY.md` produces `oms.order`
 * in a context called `oms` that nothing else in the estate has heard of, and
 * every one of its terms is a word the reader can never find from the page
 * that uses it. Failing here names the step; the alternative is a vocabulary
 * that loads and answers nothing.
 */
function validateTerms(catalog: Catalog): void {
  const contextIds = new Set(catalog.contexts.map((c) => c.id));
  const ids = new Set<string>();

  for (const term of allTerms(catalog)) {
    const where = `term ${term.id}`;
    if (term.id !== `${term.context}.${term.slug}`) {
      fail(
        `term "${term.id}" must have id "${term.context}.${term.slug}"`,
        where,
      );
    }
    if (ids.has(term.id)) fail(`term id "${term.id}" is not unique`, where);
    ids.add(term.id);
    if (!term.name) fail(`term "${term.id}" has no name`, where);
    if (!term.definition) {
      fail(`term "${term.id}" says nothing about what it is`, where);
    }
    if (!contextIds.has(term.context)) {
      fail(
        `term "${term.id}" belongs to context "${term.context}", which the catalog does not declare`,
        where,
      );
    }
  }
}

/**
 * A decision record may only point at things that exist. A dangling relates
 * entry or a half-written supersession would let the UI draw a link to
 * nowhere, so both fail the build instead.
 */
function validateAdrs(catalog: Catalog, eventIds: Set<string>): void {
  if (!Array.isArray(catalog.adrs)) fail("catalog.adrs is missing", "catalog");

  const serviceIds = new Set(allServices(catalog).map((s) => s.id));
  const contextIds = new Set(catalog.contexts.map((c) => c.id));
  const flowSlugs = new Set(catalog.flows.map((f) => f.slug));

  assertUniqueSlugs(
    catalog.adrs.map((a) => a.slug),
    "catalog",
    "adr",
  );

  const byId = new Map<string, Adr>();
  for (const adr of catalog.adrs) {
    if (byId.has(adr.id))
      fail(`adr id "${adr.id}" is not unique`, `decision ${adr.id}`);
    byId.set(adr.id, adr);
  }

  for (const adr of catalog.adrs) {
    const padded = String(adr.number).padStart(4, "0");
    if (!adr.id.endsWith(`.${padded}`)) {
      fail(
        `adr "${adr.id}" must end with its number, "${padded}"`,
        `decision ${adr.id}`,
      );
    }
    if (Number.isNaN(new Date(adr.date).getTime())) {
      fail(
        `adr "${adr.id}" has an unparseable date "${adr.date}"`,
        `decision ${adr.id}`,
      );
    }

    switch (adr.scope.kind) {
      case "context":
        if (!contextIds.has(adr.scope.context)) {
          fail(
            `adr "${adr.id}" is scoped to unknown context "${adr.scope.context}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "service":
        if (!serviceIds.has(adr.scope.service)) {
          fail(
            `adr "${adr.id}" is scoped to unknown service "${adr.scope.service}"`,
            `decision ${adr.id}`,
          );
        }
        break;
      case "org":
        break;
    }

    for (const serviceId of adr.relates.services ?? []) {
      if (!serviceIds.has(serviceId)) {
        fail(
          `adr "${adr.id}" relates to unknown service "${serviceId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const eventId of adr.relates.events ?? []) {
      if (!eventIds.has(eventId)) {
        fail(
          `adr "${adr.id}" relates to unknown event "${eventId}"`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const flowSlug of adr.relates.flows ?? []) {
      if (!flowSlugs.has(flowSlug)) {
        fail(
          `adr "${adr.id}" relates to unknown flow "${flowSlug}"`,
          `decision ${adr.id}`,
        );
      }
    }

    // Supersession is a two-way fact. Recording one half of it is a bug in
    // whatever wrote the catalog, not a display problem to paper over.
    if (adr.status === "superseded" && !adr.supersededBy) {
      fail(
        `adr "${adr.id}" is superseded but names no supersededBy`,
        `decision ${adr.id}`,
      );
    }
    if (adr.supersededBy !== undefined) {
      if (adr.status !== "superseded") {
        fail(
          `adr "${adr.id}" names supersededBy "${adr.supersededBy}" but its status is "${adr.status}", not "superseded"`,
          `decision ${adr.id}`,
        );
      }
      const successor = byId.get(adr.supersededBy);
      if (!successor) {
        fail(
          `adr "${adr.id}" is superseded by unknown adr "${adr.supersededBy}"`,
          `decision ${adr.id}`,
        );
      } else if (!(successor.supersedes ?? []).includes(adr.id)) {
        fail(
          `adr "${adr.id}" is superseded by "${successor.id}", but "${successor.id}" does not list it in supersedes`,
          `decision ${adr.id}`,
        );
      }
    }
    for (const supersededId of adr.supersedes ?? []) {
      const predecessor = byId.get(supersededId);
      if (!predecessor) {
        fail(
          `adr "${adr.id}" supersedes unknown adr "${supersededId}"`,
          `decision ${adr.id}`,
        );
      } else if (predecessor.supersededBy !== adr.id) {
        fail(
          `adr "${adr.id}" supersedes "${supersededId}", but "${supersededId}" is not marked superseded by it`,
          `decision ${adr.id}`,
        );
      }
    }
  }
}

/**
 * A pin names a repository and a commit, and names each repository once.
 *
 * Nothing else is checked here, and one omission is deliberate: a pin for a
 * repository no service claims to live in is NOT an error. The merge unions
 * sources that do not know each other, and a repository fetched for its protos
 * before anything reads its code is a normal intermediate state - the pin is
 * simply never looked up. What would be a real problem is one repository
 * pinned to two commits, and that is caught in the merge, where both sources
 * are still known and the reader can be told which file lost.
 */
function validateRepos(catalog: Catalog): void {
  const seen = new Set<string>();

  for (const pin of allRepos(catalog)) {
    const where = `repo ${pin.repo || "?"}`;
    if (!pin.repo) fail("a repo pin names no repository", where);
    if (!pin.commit) {
      fail(
        `repo "${pin.repo}" is pinned to nothing; a pin without a commit is not a place a link can point at`,
        where,
      );
    }
    if (seen.has(pin.repo)) {
      fail(`repo "${pin.repo}" is pinned twice in one catalog`, where);
    }
    seen.add(pin.repo);
  }
}
