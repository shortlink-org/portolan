// The rules the Problems page is made of, as one list a reader can see.
//
// Every rule is the same thing: a subject, a condition in CEL, a message in
// CEL, and a passport - id, severity, title, the words on the row, what it
// checks, what to do. The package ships its own in rules/builtin.json; the
// estate writes more under `problemRules` in the manifest, and there it can
// also switch a shipped rule off or re-grade it, with a reason.
//
// A rule reads one row of one subject, and the row already carries every
// fact the rule would otherwise have to look up (problem-subjects.ts). So a
// rule never walks the catalog, and the whole of what makes a row a problem
// is in the expression a reader can see on the Settings page.
//
// Rules are applied here, in the browser, over the merged catalog, and not
// at generation. Nothing about a problem is written to a fragment: the
// catalog says what is, and a rule says what should not be, and the second
// is the estate's to change without a build. That is also why a switch
// flipped on the Settings page takes effect on the next render, and why the
// same expression is type-checked twice, once when the manifest is read and
// once here, by the same module (portolan.0016, portolan.0017).

import { useMemo } from "react";
import { create } from "zustand";

import builtinJson from "../../rules/builtin.json";
import manifestJson from "../../portolan.json";
import type { Catalog, CatalogIndex } from "../catalog";
import type { Problem } from "./derive";
import { compileExpression, SUBJECT_NAMES } from "./problem-rules-cel.mjs";
import type { RuleSeverity, RuleSubject } from "./problem-rules-cel.mjs";
import { estateOf, subjectsOf } from "./problem-subjects";

export type { RuleSeverity, RuleSubject } from "./problem-rules-cel.mjs";
export { SUBJECTS } from "./problem-rules-cel.mjs";
export { estateOf, subjectsOf } from "./problem-subjects";
export type { Subject } from "./problem-subjects";

/** What every rule says about itself, and what it says in CEL. */
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
  /** Boolean CEL over the subject; the row exists when it holds. */
  when: string;
  /** String CEL over the subject; the row's note. */
  message: string;
  /** String CEL over the subject; the row's far end. Optional. */
  peer?: string;
}

/** One entry of `problemRules` in the manifest, as written. */
export interface ProblemRuleEntry {
  id: string;
  enabled?: boolean;
  severity?: RuleSeverity;
  /** Why a rule is off or re-graded; required with `enabled: false`. */
  reason?: string;
  over?: RuleSubject;
  when?: string;
  message?: string;
  peer?: string;
  title?: string;
  note?: string;
  description?: string;
  action?: string;
}

/** A rule as the page shows it: passport, switch, and where it came from. */
export interface ProblemRule extends RulePassport {
  builtin: boolean;
  enabled: boolean;
  /** The severity the passport was written with, before the manifest re-graded it. */
  defaultSeverity: RuleSeverity;
  reason?: string;
}

export const BUILTIN_RULES: readonly RulePassport[] = builtinJson as RulePassport[];

const BUILTIN_BY_ID = new Map(BUILTIN_RULES.map((rule) => [rule.id, rule]));

export function isBuiltinRule(id: string): boolean {
  return BUILTIN_BY_ID.has(id);
}

/**
 * The rules in force: every shipped one, switched or re-graded where the
 * manifest says, then the manifest's own, in manifest order. An entry naming
 * a shipped id changes that rule; any other entry is a rule of its own.
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
        when: entry.when ?? "",
        message: entry.message ?? "",
        ...(entry.peer ? { peer: entry.peer } : {}),
        builtin: false,
        enabled: entry.enabled !== false,
        ...(entry.reason ? { reason: entry.reason } : {}),
      };
    });
  return [...builtin, ...custom];
}

export function ruleById(rules: readonly ProblemRule[], id: string): ProblemRule | undefined {
  return rules.find((rule) => rule.id === id);
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
  /** Rules that could not be compiled or run, and why; their rows are absent. */
  failures: RuleFailure[];
  /**
   * How many rows each rule would produce, enabled or not. A switched-off
   * rule with a count is the page's way of saying what turning it on costs.
   */
  matches: Map<string, number>;
}

/**
 * Runs one rule over the catalog. Every row is tried; the first expression
 * that throws stops the rule, because a rule that fails on one row is a rule
 * that is wrong, not a row that is.
 */
export function runRule(
  rule: Pick<ProblemRule, "id" | "over" | "severity" | "when" | "message" | "peer">,
  catalog: Catalog,
  index: CatalogIndex,
  estate: Record<string, string[]> = estateOf(catalog),
): { problems: Problem[]; failure?: RuleFailure } {
  const problems: Problem[] = [];
  try {
    if (!rule.when || !rule.message) throw new Error("a rule needs both `when` and `message`");
    if (!SUBJECT_NAMES.includes(rule.over)) throw new Error(`unknown subject "${rule.over}"`);
    const when = compileExpression(rule.over, rule.when, "bool");
    const message = compileExpression(rule.over, rule.message, "string");
    const peer = rule.peer ? compileExpression(rule.over, rule.peer, "string") : null;
    for (const subject of subjectsOf(catalog, index, rule.over)) {
      const context = { [rule.over]: subject.row, estate };
      if (when(context) !== true) continue;
      const note = String(message(context));
      problems.push({
        rule: rule.id,
        severity: rule.severity,
        context: subject.context,
        service: subject.service,
        id: subject.id,
        peer: peer ? String(peer(context)) : "",
        note: note || undefined,
        source: subject.source,
      });
    }
    return { problems };
  } catch (cause) {
    return { problems: [], failure: { rule: rule.id, message: cause instanceof Error ? cause.message.split("\n", 1)[0]! : String(cause) } };
  }
}

/** `runRule`, by the name the Settings editor calls it: the draft is a rule like any other. */
export const runCustomRule = runRule;

/**
 * Every rule over the catalog. A switched-off rule is still run, so the page
 * can say how many rows it would produce, and its rows are left out.
 */
export function evaluateRules(catalog: Catalog, index: CatalogIndex, rules: readonly ProblemRule[]): RuleEvaluation {
  const estate = estateOf(catalog);
  const matches = new Map<string, number>();
  const failures: RuleFailure[] = [];
  const problems: Problem[] = [];
  for (const rule of rules) {
    const ran = runRule(rule, catalog, index, estate);
    if (ran.failure) failures.push(ran.failure);
    matches.set(rule.id, ran.problems.length);
    if (rule.enabled) problems.push(...ran.problems);
  }
  return { problems, failures, matches };
}

/**
 * The shipped rules, all on, over a catalog - or only the ones named. What
 * the readers used to answer, for a test that holds a rule to a fixture.
 */
export function builtinProblems(catalog: Catalog, index: CatalogIndex, ids?: readonly string[]): Problem[] {
  const rules = resolveRules([]).filter((rule) => !ids || ids.includes(rule.id));
  const { problems, failures } = evaluateRules(catalog, index, rules);
  if (failures.length > 0) throw new Error(failures.map((failure) => `${failure.rule}: ${failure.message}`).join("\n"));
  return [...problems.filter((p) => p.severity === "error"), ...problems.filter((p) => p.severity === "warning")];
}

// ---------------------------------------------------------------------------
// The manifest's entries, live.

type ManifestWithRules = { problemRules?: ProblemRuleEntry[] };

/** The `problemRules` of a manifest, or none: a manifest without the key has every shipped rule on. */
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
