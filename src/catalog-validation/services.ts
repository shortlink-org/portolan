import type { Catalog, Service } from "../catalog-model.ts";
import {
  CLASSIFICATIONS,
  COMPONENT_KINDS,
  GROUP_KINDS,
  HTTP_METHOD_BASES,
  STREAMING,
  allServices,
} from "../catalog-model.ts";
import { validateBlocks } from "./aggregates.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";
import type { StepRefs } from "./flows.ts";

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
      if (message.encoding !== undefined && (typeof message.encoding !== "string" || message.encoding === "")) {
        fail(
          `message "${message.name}" on channel "${channel.address}" has an empty encoding`,
          `service ${service.id} / channel ${channel.address}`,
        );
      }
      if (message.contentType !== undefined && (typeof message.contentType !== "string" || message.contentType === "")) {
        fail(
          `message "${message.name}" on channel "${channel.address}" has an empty content type`,
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

/**
 * Every context and every service in it: identity, kinds, owners, hosts,
 * Gateway exposures, dependencies, interfaces and their messages, channels,
 * aggregates and events. While it walks, it records the event ids, consumed
 * call ids and provided method refs a flow step may later resolve to.
 */
export function validateContexts(catalog: Catalog, refs: StepRefs): void {
  const { eventIds, rpcIds, providedRpcRefs } = refs;

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
      // Hosts and dials are names, and a name is checked the way a handle
      // is: not blank, not listed twice. Two services behind one Ingress
      // host is one host on two pages, which is what the manifests say.
      for (const field of ["hosts", "dials"] as const) {
        const names = new Set<string>();
        for (const name of service[field] ?? []) {
          if (!name.trim()) {
            fail(
              `service "${service.id}" has a ${field.slice(0, -1)} with no name`,
              `service ${service.id}`,
            );
          }
          if (names.has(name)) {
            fail(
              `service "${service.id}" names ${field.slice(0, -1)} "${name}" twice`,
              `service ${service.id}`,
            );
          }
          names.add(name);
        }
      }
      const gatewayExposureIDs = new Set<string>();
      for (const exposure of service.gatewayExposures ?? []) {
        if (!exposure.id.trim()) {
          fail(
            `service "${service.id}" has a Gateway exposure with no id`,
            `service ${service.id}`,
          );
        }
        if (gatewayExposureIDs.has(exposure.id)) {
          fail(
            `service "${service.id}" names Gateway exposure "${exposure.id}" twice`,
            `service ${service.id}`,
          );
        }
        gatewayExposureIDs.add(exposure.id);
        for (const field of [
          "routeNamespace",
          "routeName",
          "gatewayNamespace",
          "gatewayName",
          "listener",
          "protocol",
          "backendNamespace",
          "backendName",
        ] as const) {
          if (!exposure[field].trim()) {
            fail(
              `Gateway exposure "${exposure.id}" has no ${field}`,
              `service ${service.id}`,
            );
          }
        }
        if (!["HTTPRoute", "GRPCRoute", "TLSRoute"].includes(exposure.routeKind)) {
          fail(
            `Gateway exposure "${exposure.id}" has unsupported route kind "${exposure.routeKind}"`,
            `service ${service.id}`,
          );
        }
        if (!["manifest", "api", "both"].includes(exposure.basis)) {
          fail(
            `Gateway exposure "${exposure.id}" has unsupported basis "${exposure.basis}"`,
            `service ${service.id}`,
          );
        }
        if (!Number.isInteger(exposure.port) || exposure.port <= 0) {
          fail(
            `Gateway exposure "${exposure.id}" has invalid listener port`,
            `service ${service.id}`,
          );
        }
        const hostnames = new Set<string>();
        for (const hostname of exposure.hostnames) {
          if (!hostname.trim() || hostnames.has(hostname)) {
            fail(
              `Gateway exposure "${exposure.id}" has an empty or repeated hostname`,
              `service ${service.id}`,
            );
          }
          hostnames.add(hostname);
        }
      }
      const dependencies = new Set<string>();
      for (const dependency of service.dependsOn ?? []) {
        if (!dependency.trim()) {
          fail(
            `service "${service.id}" has a dependency with no id`,
            `service ${service.id}`,
          );
        }
        if (dependency === service.id) {
          fail(
            `service "${service.id}" depends on itself`,
            `service ${service.id}`,
          );
        }
        if (dependencies.has(dependency)) {
          fail(
            `service "${service.id}" depends on "${dependency}" twice`,
            `service ${service.id}`,
          );
        }
        dependencies.add(dependency);
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
          if (method.http?.methodBasis !== undefined) {
            if (!HTTP_METHOD_BASES.includes(method.http.methodBasis)) {
              fail(
                `method "${provided.id}/${method.name}" names its verb on basis "${method.http.methodBasis}"; expected one of ${HTTP_METHOD_BASES.join(", ")}`,
                `service ${service.id}`,
              );
            }
            // An inferred verb is a verb and a reading; either one missing
            // leaves a guess nobody can check.
            if (
              method.http.methodBasis === "inferred" &&
              (!method.http.method || !method.http.methodEvidence)
            ) {
              fail(
                `method "${provided.id}/${method.name}" infers its HTTP verb but carries no ${method.http.method ? "evidence for it" : "verb"}`,
                `service ${service.id}`,
              );
            }
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
      // An operation publishes its own service's events; one it names that the
      // service does not declare is a link into nothing.
      const ownEvents = new Set(
        service.aggregates.flatMap((aggregate) => aggregate.events.map((event) => event.id)),
      );
      for (const aggregate of service.aggregates) {
        for (const operation of aggregate.operations) {
          for (const event of operation.emits ?? []) {
            if (!ownEvents.has(event)) {
              fail(
                `operation "${operation.id}" of aggregate "${aggregate.id}" says it emits "${event}", which is not an event of service "${service.id}"`,
                `aggregate ${aggregate.id} / operation ${operation.id}`,
              );
            }
          }
          for (const method of operation.exposedBy ?? []) {
            if (!methods.has(method)) {
              fail(
                `operation "${operation.id}" of aggregate "${aggregate.id}" says it is exposed by "${method}", which no interface of service "${service.id}" declares`,
                `aggregate ${aggregate.id} / operation ${operation.id}`,
              );
            }
          }
          for (const field of operation.fields ?? []) {
            if (field.ref !== undefined && !(field.ref in catalog.defs)) {
              fail(
                `field "${field.name}" of operation "${operation.id}" of aggregate "${aggregate.id}" references unknown def "${field.ref}"`,
                `aggregate ${aggregate.id} / operation ${operation.id} / field ${field.name}`,
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
}

export function validateServiceDependencies(catalog: Catalog): void {
  const ids = new Set(allServices(catalog).map((service) => service.id));
  for (const service of allServices(catalog)) {
    for (const dependency of service.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        fail(
          `service "${service.id}" depends on service "${dependency}", which is not in the catalog`,
          `service ${service.id}`,
        );
      }
    }
  }
}
