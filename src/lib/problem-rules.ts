// The rules the Problems page is made of, as one list a reader can see.
//
// Two kinds of rule, one shape. A built-in rule is a reader in TypeScript -
// derive.ts, data-problems.ts, wire-problems.ts, proto-problems.ts,
// deploy-problems.ts - with a passport in rules/builtin.json: its id, the
// subject its rows are about, how wrong a row is, and what to do about one.
// A custom rule is written in the manifest under `problemRules`, in CEL over
// one subject, and carries the same passport fields itself. The manifest can
// also switch a built-in rule off or re-grade it, with a reason.
//
// Rules are applied here, in the browser, over the merged catalog - where the
// readers already run - and not at generation. Nothing about a problem is
// written to a fragment: the catalog says what is, and a rule says what should
// not be, and the second is the estate's to change without a build. That is
// also why a switch flipped on the Settings page takes effect on the next
// render, and why the same expression is type-checked twice, once when the
// manifest is read and once here, by the same module (portolan.0016).

import { useMemo } from "react";
import { create } from "zustand";

import builtinJson from "../../rules/builtin.json";
import manifestJson from "../../portolan.json";
import type { Catalog, CatalogIndex, Event, Service, Table } from "../catalog";
import { allDeployments, deploys } from "../catalog";
import { compileExpression, SUBJECT_NAMES } from "./problem-rules-cel.mjs";
import type { RuleSeverity, RuleSubject } from "./problem-rules-cel.mjs";
import type { Finding, Problem } from "./derive";

export type { RuleSeverity, RuleSubject } from "./problem-rules-cel.mjs";
export { SUBJECTS } from "./problem-rules-cel.mjs";

/** What every rule says about itself, built-in or not. */
export interface RulePassport {
  id: string;
  /** What a row of this rule is about, and where its near end links to. */
  over: RuleSubject;
  severity: RuleSeverity;
  title: string;
  /** The words on the row, after the arrow. */
  note: string;
  description: string;
  /** What a reader does about a row. */
  action: string;
}

/** One entry of `problemRules` in the manifest, as written. */
export interface ProblemRuleEntry {
  id: string;
  enabled?: boolean;
  severity?: RuleSeverity;
  /** Why a rule is off or re-graded; required with `enabled: false`. */
  reason?: string;
  over?: RuleSubject;
  /** Boolean CEL over the subject; the row exists when it holds. */
  when?: string;
  /** String CEL over the subject; the row's note. */
  message?: string;
  /** String CEL over the subject; the row's far end. Optional. */
  peer?: string;
  title?: string;
  note?: string;
  description?: string;
  action?: string;
}

/** A rule as the page shows it: passport, switch, and the CEL when there is any. */
export interface ProblemRule extends RulePassport {
  builtin: boolean;
  enabled: boolean;
  /** The severity the passport was written with, before the manifest re-graded it. */
  defaultSeverity: RuleSeverity;
  reason?: string;
  when?: string;
  message?: string;
  peer?: string;
}

export const BUILTIN_RULES: readonly RulePassport[] = builtinJson as RulePassport[];

const BUILTIN_BY_ID = new Map(BUILTIN_RULES.map((rule) => [rule.id, rule]));

export function isBuiltinRule(id: string): boolean {
  return BUILTIN_BY_ID.has(id);
}

/**
 * The rules in force: every built-in one, switched or re-graded where the
 * manifest says, then the manifest's own, in manifest order. An entry naming
 * a built-in id changes that rule; any other entry is a rule of its own.
 */
export function resolveRules(entries: readonly ProblemRuleEntry[]): ProblemRule[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const builtin = BUILTIN_RULES.map((passport): ProblemRule => {
    const entry = byId.get(passport.id);
    return {
      ...passport,
      builtin: true,
      enabled: entry?.enabled !== false,
      defaultSeverity: passport.severity,
      severity: entry?.severity ?? passport.severity,
      ...(entry?.reason ? { reason: entry.reason } : {}),
    };
  });
  const custom = entries
    .filter((entry) => !BUILTIN_BY_ID.has(entry.id))
    .map((entry): ProblemRule => {
      const severity = entry.severity ?? "warning";
      return {
        id: entry.id,
        over: entry.over ?? "service",
        severity,
        defaultSeverity: severity,
        title: entry.title ?? entry.id,
        note: entry.note ?? entry.title ?? entry.id,
        description: entry.description ?? "",
        action: entry.action ?? "",
        builtin: false,
        enabled: entry.enabled !== false,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.when ? { when: entry.when } : {}),
        ...(entry.message ? { message: entry.message } : {}),
        ...(entry.peer ? { peer: entry.peer } : {}),
      };
    });
  return [...builtin, ...custom];
}

export function ruleById(rules: readonly ProblemRule[], id: string): ProblemRule | undefined {
  return rules.find((rule) => rule.id === id);
}

// ---------------------------------------------------------------------------
// Subjects: the flat view of one row a CEL rule reads.

/** One row a rule is asked about, with what a problem needs to know of it. */
export interface Subject {
  id: string;
  context: string;
  service: string;
  source: string | undefined;
  /** What the expression sees, under the subject's name. */
  row: Record<string, unknown>;
}

const int = (n: number) => BigInt(n);

function contextOf(index: CatalogIndex, service: Service | undefined): string {
  return service ? index.serviceContext.get(service.id)?.id ?? "" : "";
}

function eventSubject(index: CatalogIndex, event: Event): Subject {
  const owner = index.eventOwner.get(event.id);
  const latest = event.versions[event.versions.length - 1];
  return {
    id: event.id,
    context: contextOf(index, owner?.service),
    service: owner?.service.id ?? "",
    source: latest?.source,
    row: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      aggregate: owner?.aggregate.id ?? "",
      service: owner?.service.id ?? "",
      context: contextOf(index, owner?.service),
      versions: int(event.versions.length),
      deprecated: latest?.deprecated === true,
      consumers: event.consumers.map((consumer) => consumer.service),
      unresolvedConsumers: int(event.consumers.filter((consumer) => consumer.status === "unresolved").length),
      wireName: event.wire?.name ?? "",
      channel: event.wire?.channel ?? "",
      fields: latest?.fields.map((field) => field.name) ?? [],
    },
  };
}

function tableSubject(index: CatalogIndex, table: Table, store: { id: string; kind: string; owner: string }): Subject {
  const owner = index.serviceById.get(store.owner);
  const accesses = table.accesses ?? [];
  return {
    id: table.id,
    context: contextOf(index, owner),
    service: store.owner,
    source: undefined,
    row: {
      id: table.id,
      name: table.name,
      store: store.id,
      storeKind: store.kind,
      owner: store.owner,
      context: contextOf(index, owner),
      role: table.role ?? "",
      aggregate: table.persists?.aggregate ?? "",
      block: table.persists?.block ?? "",
      columns: table.columns.map((column) => column.name),
      primaryKey: table.columns.filter((column) => column.pk).map((column) => column.name),
      foreignKeys: table.columns.flatMap((column) => (column.fk ? [column.fk.table] : [])),
      indexes: int(table.indexes?.length ?? 0),
      reads: int(accesses.filter((access) => access.operation === "read").length),
      writes: int(accesses.filter((access) => access.operation === "write").length),
      deletes: int(accesses.filter((access) => access.operation === "delete").length),
    },
  };
}

/** Every row of one subject kind in the catalog, in catalog order. */
export function subjectsOf(catalog: Catalog, index: CatalogIndex, over: RuleSubject): Subject[] {
  const services = catalog.contexts.flatMap((context) => context.services.map((service) => ({ context, service })));
  switch (over) {
    case "service":
      return services.map(({ context, service }) => ({
        id: service.id,
        context: context.id,
        service: service.id,
        source: undefined,
        row: {
          id: service.id,
          slug: service.slug,
          name: service.name,
          context: context.id,
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
    case "event":
      return services.flatMap(({ service }) =>
        service.aggregates.flatMap((aggregate) => aggregate.events.map((event) => eventSubject(index, event))),
      );
    case "channel":
      return services.flatMap(({ context, service }) =>
        (service.channels ?? []).map((channel) => ({
          id: channel.address,
          context: context.id,
          service: service.id,
          source: channel.source,
          row: {
            address: channel.address,
            kind: channel.kind ?? "event",
            title: channel.title ?? "",
            service: service.id,
            context: context.id,
            sends: channel.messages.filter((message) => message.direction === "send").map((message) => message.name),
            receives: channel.messages.filter((message) => message.direction === "receive").map((message) => message.name),
            source: channel.source ?? "",
          },
        })),
      );
    case "table":
      return (catalog.stores ?? []).flatMap((store) => store.tables.map((table) => tableSubject(index, table, store)));
    case "deployment":
      return allDeployments(catalog).map((deployment) => {
        const owner = services.find(({ service }) => deploys(deployment, service));
        return {
          id: deployment.id,
          context: owner?.context.id ?? "",
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
            targetRevision: deployment.targetRevision,
            revision: deployment.revision,
            tool: deployment.tool,
            service: owner?.service.id ?? deployment.service ?? "",
            context: owner?.context.id ?? "",
            images: deployment.images ?? [],
            basis: deployment.basis ?? "api",
            drifted: deployment.drift !== undefined && Object.keys(deployment.drift).length > 0,
          },
        };
      });
    case "call":
      return services.flatMap(({ context, service }) =>
        service.consumes.map((call) => {
          const slash = call.id.lastIndexOf("/");
          return {
            id: call.id,
            context: context.id,
            service: service.id,
            source: call.source,
            row: {
              id: call.id,
              interface: slash >= 0 ? call.id.slice(0, slash) : call.id,
              method: slash >= 0 ? call.id.slice(slash + 1) : "",
              peer: call.peer,
              status: call.status,
              resolved: call.status !== "unresolved",
              service: service.id,
              context: context.id,
              source: call.source,
              module: call.module ?? "",
            },
          };
        }),
      );
  }
}

/** The names the estate answers to, for `x in estate.services`. */
export function estateOf(catalog: Catalog): Record<string, string[]> {
  const services = catalog.contexts.flatMap((context) => context.services);
  return {
    services: services.map((service) => service.id),
    contexts: catalog.contexts.map((context) => context.id),
    stores: (catalog.stores ?? []).map((store) => store.id),
    channels: [...new Set(services.flatMap((service) => (service.channels ?? []).map((channel) => channel.address)))],
    externals: (catalog.externals ?? []).map((external) => external.id),
  };
}

// ---------------------------------------------------------------------------
// Evaluation.

export interface RuleFailure {
  rule: string;
  message: string;
}

export interface RuleEvaluation {
  /** Rows the enabled rules produced, in rule order, not yet sorted by severity. */
  problems: Problem[];
  /** Custom rules that could not be compiled or run, and why; their rows are absent. */
  failures: RuleFailure[];
  /**
   * How many rows each rule would produce, enabled or not. A switched-off
   * rule with a count is the page's way of saying what turning it on costs.
   */
  matches: Map<string, number>;
}

/**
 * Runs one custom rule over the catalog. Every row is tried; the first
 * expression that throws stops the rule, because a rule that fails on one row
 * is a rule that is wrong, not a row that is.
 */
export function runCustomRule(
  rule: ProblemRule,
  catalog: Catalog,
  index: CatalogIndex,
  estate: Record<string, string[]> = estateOf(catalog),
): { problems: Problem[]; failure?: RuleFailure } {
  const problems: Problem[] = [];
  try {
    if (!rule.when || !rule.message) throw new Error("a custom rule needs both `when` and `message`");
    if (!SUBJECT_NAMES.includes(rule.over)) throw new Error(`unknown subject "${rule.over}"`);
    const when = compileExpression(rule.over, rule.when, "bool");
    const message = compileExpression(rule.over, rule.message, "string");
    const peer = rule.peer ? compileExpression(rule.over, rule.peer, "string") : null;
    for (const subject of subjectsOf(catalog, index, rule.over)) {
      const context = { [rule.over]: subject.row, estate };
      if (when(context) !== true) continue;
      problems.push({
        kind: "rule",
        rule: rule.id,
        severity: rule.severity,
        context: subject.context,
        service: subject.service,
        id: subject.id,
        peer: peer ? String(peer(context)) : "",
        note: String(message(context)),
        source: subject.source,
      });
    }
    return { problems };
  } catch (cause) {
    return { problems: [], failure: { rule: rule.id, message: cause instanceof Error ? cause.message.split("\n", 1)[0]! : String(cause) } };
  }
}

/**
 * Turns what the readers found into the problems the rules allow: a finding
 * whose rule is off is dropped, one whose rule is re-graded takes the new
 * severity, and the custom rules add their rows after. A finding whose kind
 * has no passport is kept as it is - a rule nobody can switch is still a
 * finding - and the test over rules/builtin.json makes sure there is none.
 */
export function evaluateRules(
  findings: readonly Finding[],
  catalog: Catalog,
  index: CatalogIndex,
  rules: readonly ProblemRule[],
): RuleEvaluation {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const matches = new Map<string, number>();
  const failures: RuleFailure[] = [];
  const problems: Problem[] = [];
  for (const finding of findings) {
    matches.set(finding.kind, (matches.get(finding.kind) ?? 0) + 1);
    const rule = byId.get(finding.kind);
    if (rule && !rule.enabled) continue;
    problems.push({ ...finding, rule: finding.kind, severity: rule?.severity ?? finding.severity });
  }
  const custom = rules.filter((rule) => !rule.builtin);
  if (custom.length > 0) {
    const estate = estateOf(catalog);
    for (const rule of custom) {
      const ran = runCustomRule(rule, catalog, index, estate);
      if (ran.failure) failures.push(ran.failure);
      matches.set(rule.id, ran.problems.length);
      if (rule.enabled) problems.push(...ran.problems);
    }
  }
  return { problems, failures, matches };
}

// ---------------------------------------------------------------------------
// The manifest's entries, live.

type ManifestWithRules = { problemRules?: ProblemRuleEntry[] };

/** The `problemRules` of a manifest, or none: a manifest without the key has every built-in rule on. */
export function problemRulesFromManifest(manifest: unknown): ProblemRuleEntry[] {
  const entries = (manifest as ManifestWithRules | null | undefined)?.problemRules;
  return Array.isArray(entries) ? entries : [];
}

interface RuleEntriesState {
  entries: ProblemRuleEntry[];
  setEntries: (entries: ProblemRuleEntry[]) => void;
}

/**
 * The entries in force in this page. They start as the manifest the bundle
 * was built with; in local mode the Settings page replaces them with what it
 * wrote, and a change to portolan.json on disk arrives through HMR below, so
 * the Problems page never shows rules the file no longer has.
 */
export const useRuleEntries = create<RuleEntriesState>((set) => ({
  entries: problemRulesFromManifest(manifestJson),
  setEntries: (entries) => set({ entries }),
}));

export function currentRuleEntries(): ProblemRuleEntry[] {
  return useRuleEntries.getState().entries;
}

/** The rules in force, recomputed when the entries change. For components. */
export function useProblemRules(): ProblemRule[] {
  const entries = useRuleEntries((state) => state.entries);
  return useMemo(() => resolveRules(entries), [entries]);
}

if (import.meta.hot) {
  import.meta.hot.accept("../../portolan.json", (next) => {
    const incoming = (next as { default?: unknown } | undefined)?.default;
    if (incoming) useRuleEntries.getState().setEntries(problemRulesFromManifest(incoming));
  });
}
