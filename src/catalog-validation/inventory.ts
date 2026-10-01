import type { Catalog } from "../catalog-model.ts";
import { safeWorkItemUrl, workItemLinkKey, workItemTargetExists } from "../lib/work-items.ts";
import {
  allAggregates,
  allDeployments,
  allExternals,
  allModules,
  allRepos,
  allServices,
} from "../catalog-model.ts";
import { assertUniqueSlugs, fail } from "./errors.ts";

export function validateWorkItems(catalog: Catalog): void {
  const items = new Set<string>();
  for (const item of catalog.workItems ?? []) {
    if (![item.tracker, item.key, item.provider].every((value) => typeof value === "string" && value.trim()) || item.id !== `${item.tracker}:${item.key}` || items.has(item.id))
      fail("work item has invalid or duplicate identity", "workItems");
    if (!safeWorkItemUrl(item.url)) fail(`work item "${item.id}" has an invalid URL`, "workItems");
    for (const field of ["title", "status", "assignee", "updatedAt"] as const) {
      if (item[field] !== undefined && typeof item[field] !== "string") fail(`work item "${item.id}" has invalid ${field}`, "workItems");
    }
    if (item.updatedAt !== undefined && !Number.isFinite(Date.parse(item.updatedAt))) fail("invalid work item snapshot date", "workItems");
    items.add(item.id);
  }
  const links = new Set<string>();
  for (const link of catalog.workItemLinks ?? []) {
    if (!items.has(link.workItem)) fail(`unknown work item "${link.workItem}"`, "workItemLinks");
    if (!workItemTargetExists(catalog, link.target)) fail(`work item "${link.workItem}" has an unknown target`, "workItemLinks");
    if (!["declared", "source-file", "service-directory"].includes(link.basis)) fail("unknown work item link basis", "workItemLinks");
    const key = workItemLinkKey(link);
    if (links.has(key)) fail("duplicate work item link", "workItemLinks");
    links.add(key);
    if (!Array.isArray(link.commits) || (link.basis !== "declared" && !link.commits.length)) fail("derived work item link needs commits", "workItemLinks");
    const commits = new Set<string>();
    for (const commit of link.commits) {
      if (!safeWorkItemUrl(commit.repository) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.sha)) fail("invalid work item commit", "workItemLinks");
      if (typeof commit.subject !== "string" || typeof commit.author !== "string" || typeof commit.date !== "string" || !Number.isFinite(Date.parse(commit.date))) fail("invalid work item commit metadata", "workItemLinks");
      if (!Array.isArray(commit.paths) || (link.basis !== "declared" && !commit.paths.length) || commit.paths.some((path) => typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes(".."))) fail("invalid work item commit paths", "workItemLinks");
      const identity = JSON.stringify([commit.repository, commit.sha]);
      if (commits.has(identity)) fail("duplicate work item commit", "workItemLinks");
      commits.add(identity);
    }
  }
}

/**
 * A deployment names an Application, and names it once.
 *
 * What is not checked is deliberate, and the same omission `validateRepos`
 * makes: a deployment of a repository no service claims is NOT an error. The
 * snapshot lists what the control plane manages, and an Application for a
 * service nobody has read yet, or for something that is not a service at
 * all - a monitoring stack, an ingress controller - is the ordinary case.
 * It simply matches nothing on a service page. Nor is a row with an empty
 * environment or repository: the snapshot says what the deployer said, and
 * a build must not go red because one Application was written oddly.
 */
export function validateDeployments(catalog: Catalog): void {
  const seen = new Set<string>();

  for (const deployment of allDeployments(catalog)) {
    const where = `deployment ${deployment.id || "?"}`;
    if (!deployment.id) fail("a deployment has no id", where);
    if (!deployment.name) fail(`deployment "${deployment.id}" names no application`, where);
    if (seen.has(deployment.id)) {
      fail(`deployment "${deployment.id}" is listed twice in one catalog`, where);
    }
    seen.add(deployment.id);
  }
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
export function validateModules(catalog: Catalog): void {
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

  // Event schemas name a fully-qualified message rather than merely a module:
  // a module can hold hundreds of payloads, and a link to its root would not
  // prove which one defines this version. Messages use their interface's proto
  // package because the stored message name is intentionally short.
  const messagesByModule = new Map<string, Set<string>>();
  for (const service of allServices(catalog)) {
    for (const provided of service.provides) {
      if (provided.module === undefined) continue;
      const at = provided.id.lastIndexOf(".");
      const pkg = at < 0 ? "" : provided.id.slice(0, at);
      const messages =
        messagesByModule.get(provided.module) ?? new Set<string>();
      for (const message of provided.messages ?? []) {
        const name = message.name.replace(/^\./, "");
        messages.add(name.includes(".") || !pkg ? name : `${pkg}.${name}`);
      }
      messagesByModule.set(provided.module, messages);
    }
  }

  for (const event of allAggregates(catalog).flatMap(
    (aggregate) => aggregate.events,
  )) {
    for (const version of event.versions) {
      if (version.schema === undefined) continue;
      const where = `event "${event.id}" version "${version.version}"`;
      const path = `event ${event.id}@${version.version}`;
      if (!version.schema.module) {
        fail(`${where} has a schema with no module`, path);
      }
      if (!version.schema.message) {
        fail(`${where} has a schema with no message`, path);
      }
      refers(version.schema.module, where, path);
      const message = version.schema.message.replace(/^\./, "");
      if (!messagesByModule.get(version.schema.module)?.has(message)) {
        fail(
          `${where} names protobuf message "${version.schema.message}", which module "${version.schema.module}" does not declare`,
          path,
        );
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
export function validateExternals(catalog: Catalog): void {
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
export function validateRepos(catalog: Catalog): void {
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
