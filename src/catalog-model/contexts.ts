// The estate's top grouping level and what it owns: bounded contexts, the
// services inside them, and the externals that sit beside them at the root.

import type { Catalog } from "./catalog.ts";
import type { RpcCall, RpcService } from "./interfaces.ts";
import type { Aggregate } from "./aggregates.ts";
import type { Channel } from "./events.ts";

/**
 * A system outside the estate, with a contract.
 *
 * The difference from a service is what the catalog may claim about it: what it
 * answers on, and nothing else. The difference from an `unknown` participant
 * is that the calls land: a step to an external names an operation its
 * document declares, so the arrow is `declared`, not `unresolved` - and the
 * catalog still does not pretend to own the far end.
 */
export interface External {
  /** Sits at the root beside the contexts, so its id is its slug and has no dot. */
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Where the third party documents itself, for a reader who needs more than the copy. */
  url?: string;
  provides: RpcService[];
}
/**
 * A bounded context: the estate's top grouping level, and nothing more. It owns
 * services; it states no relationships to its neighbours. The map of who talks
 * to whom is already drawn from the calls and events themselves.
 */
export interface BoundedContext {
  /** A context sits at the root, so its id is its slug. The validator holds them equal. */
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Semantic role of this top-level group. Absent preserves the historical bounded-context meaning (portolan.0004). */
  kind?: GroupKind;
  /**
   * How strategically the domain is rated. A badge, and only a badge: it never
   * orders, groups or filters anything. Absent means the estate has not made
   * the call, which renders as nothing at all rather than a default.
   */
  classification?: Classification;
  /** LikeC4 view to embed on the context page, when the derived `ctx_<id>` is not the one wanted. */
  viewId?: string;
  services: Service[];
}

export type GroupKind =
  "bounded-context" | "system" | "product" | "team" | "namespace";

export const GROUP_KINDS: readonly GroupKind[] = [
  "bounded-context",
  "system",
  "product",
  "team",
  "namespace",
] as const;

export type Classification = "core" | "supporting" | "generic";

export const CLASSIFICATIONS: readonly Classification[] = [
  "core",
  "supporting",
  "generic",
] as const;
export interface Service {
  id: string; // "<context>.<slug>", e.g. "shop.oms"
  slug: string;
  name: string;
  repo: string;
  path: string;
  readme: string; // markdown
  /** Runtime or code role. Absent preserves the historical service meaning. */
  kind?: ComponentKind;
  /** Technology names discovered from build and deployment manifests. */
  technologies?: string[];
  provides: RpcService[];
  consumes: RpcCall[];
  /**
   * Services this service depends on when a catalog source knows the
   * component relationship but not a concrete RPC, message, or store.
   */
  dependsOn?: string[];
  /** Interfaces read from vendored proto copies, retained for drift checks. */
  copies?: RpcService[];
  aggregates: Aggregate[];
  /**
   * Stores this service touches, by id — the ones it owns and the ones it only
   * reads. Ownership is not stated here: a store names its own owner, so a
   * service listing a store it does not own is reading it, and the pages say
   * so rather than guessing.
   */
  stores?: string[];
  /**
   * Schema modules this service publishes or vendors, by id. Which of the two
   * is not stated here: a module names its own owner, so a module in this list
   * that does not call this service its owner is one the service reads.
   */
  modules?: string[];
  /**
   * Channels this service declares it publishes on or listens to, read out of
   * an AsyncAPI document. Absent for a service with no such document, which is
   * not the same as a service that speaks to nobody.
   */
  channels?: Channel[];
  /**
   * Who to ask about it, as CODEOWNERS spells them: `@acme/oms-team`,
   * `@someone`, `dev@acme.io`.
   *
   * Handles, and deliberately nothing more. Resolving one to the people in it
   * is a call to a forge's API, which needs a credential, answers differently
   * tomorrow, and would put the estate's documentation behind an outage. A
   * handle is what the reviewer types and what the file says, so a handle is
   * what the page shows.
   *
   * Absent means nobody was named, which is not the same as nobody owning it -
   * an estate that keeps no CODEOWNERS has an owner for everything and has
   * written it down nowhere.
   */
  owners?: string[];
  /**
   * What a developer types against the checkout: the make targets, npm
   * scripts, just recipes and task-runner tasks the repository declares. Read
   * from the runner files, never from the README, so the list is the one the
   * runner would accept. Absent when nothing declares any, which is not the
   * same as a service that cannot be built.
   */
  commands?: Command[];
  /**
   * The names this service answers on, read from what deploys it: a
   * Kubernetes Service's name in its short, namespaced, `svc` and fully
   * qualified forms, and the hosts of the Ingress or an attached Gateway API
   * Route in front of it. Written so that a call another service is configured
   * to make to `pricing.shop.svc` can find the service that answers. Absent when
   * nothing in the tree says where the service is reachable.
   */
  hosts?: string[];
  /**
   * Accepted Gateway API attachments that lead to this service. Each record
   * keeps the Route, Gateway listener and backend Service that prove the
   * exposure; `hosts` remains the compact lookup index derived from them.
   */
  gatewayExposures?: GatewayExposure[];
  /**
   * The in-cluster names this service's workload is configured to reach,
   * read out of its environment and config maps and reduced to the host
   * alone. A value is never kept: not the variable it came from, not the
   * scheme, port, path or credentials around the name. Only a name the
   * cluster resolves qualifies, so a password in an environment variable is
   * not something this list can hold by shape.
   */
  dials?: string[];
}

/** One Route -> Gateway listener -> Kubernetes Service attachment. */
export interface GatewayExposure {
  id: string;
  hostnames: string[];
  routeKind: "HTTPRoute" | "GRPCRoute" | "TLSRoute";
  routeNamespace: string;
  routeName: string;
  gatewayNamespace: string;
  gatewayName: string;
  listener: string;
  protocol: string;
  port: number;
  backendNamespace: string;
  backendName: string;
  basis: GatewayExposureBasis;
  /** Route manifest, spelled from the service's repository. */
  source?: string;
  /** The manifest values where the live cluster reports something else. */
  drift?: GatewayExposureDrift;
}

export type GatewayExposureBasis = "manifest" | "api" | "both";

export interface GatewayExposureDrift {
  hostnames?: string[];
  protocol?: string;
  port?: number;
}

/**
 * One entry of a task runner's file: a make target, an npm script, a just
 * recipe, a Taskfile task, a poe or pdm task.
 *
 * `run` is the whole point - the line a reader copies - and it is spelled
 * here rather than rebuilt from the runner and the name, because `npm test`
 * and `npm run typecheck` are two spellings of one runner and the page should
 * not have to know which scripts npm treats specially.
 */
export interface Command {
  /** The tool the line is typed at: make, npm, pnpm, yarn, bun, just, task, poe, pdm. */
  runner: string;
  /** The target, script, recipe or task as its file spells it. */
  name: string;
  /** The line to type at a shell in the service's directory. */
  run: string;
  /**
   * What the file says the command is for, when it says anything: a `##`
   * comment on a make target, a `#` line over a just recipe, a task's `desc`,
   * a poe task's `help`. Most files say nothing.
   */
  doc?: string;
  /**
   * What the runner executes for it: the recipe, the script line, the cmds.
   * Carried so a name that says nothing can still be read, and shown folded,
   * because a build script is not a sentence.
   */
  body?: string;
  /** The file and line the entry was read at. */
  source?: string;
}

export type ComponentKind =
  | "service"
  | "application"
  | "webapp"
  | "worker"
  | "job"
  | "function"
  | "cli"
  | "library"
  | "data-pipeline";

export const COMPONENT_KINDS: readonly ComponentKind[] = [
  "service",
  "application",
  "webapp",
  "worker",
  "job",
  "function",
  "cli",
  "library",
  "data-pipeline",
] as const;

/** Neutral vocabulary for consumers that do not assume DDD. */
export type Group = BoundedContext;
export type Component = Service;

export function allServices(catalog: Catalog): Service[] {
  return catalog.contexts.flatMap((c) => c.services);
}

/** Neutral alias for allServices; both names intentionally address the same wire model. */
export function allComponents(catalog: Catalog): Component[] {
  return allServices(catalog);
}

export function groupKind(group: Group): GroupKind {
  return group.kind ?? "bounded-context";
}

export function componentKind(component: Component): ComponentKind {
  return component.kind ?? "service";
}

/** Every system outside the estate with a contract, in catalog order. */
export function allExternals(catalog: Catalog): External[] {
  return catalog.externals ?? [];
}

/** Who to ask about a service, without the caller having to know the field is optional. */
export function ownersOf(service: Service): string[] {
  return service.owners ?? [];
}

export function technologiesOf(component: Component): string[] {
  return component.technologies ?? [];
}

export function commandsOf(component: Component): Command[] {
  return component.commands ?? [];
}
