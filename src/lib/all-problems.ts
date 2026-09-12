// Every reading the catalog makes of itself, in one list.
//
// The rules in force - the shipped ones, switched and re-graded as the
// manifest says, and the estate's own - run over the merged catalog, and
// what they find comes out as problems. The problems page, the overview and
// the landing all want the union, errors first - a boundary leak is not the
// same kind of news as a column whose type has drifted, and mixing them
// buries the first.

import type { Catalog, CatalogIndex } from "../catalog";
import type { Problem } from "./derive";
import { currentRuleEntries, evaluateRules, resolveRules } from "./problem-rules";
import type { ProblemRule, RuleEvaluation } from "./problem-rules";

/** The rules over the catalog, with what they had to say about it. */
export function evaluateProblems(
  catalog: Catalog,
  index: CatalogIndex,
  rules: readonly ProblemRule[] = resolveRules(currentRuleEntries()),
): RuleEvaluation {
  const evaluation = evaluateRules(catalog, index, rules);
  return { ...evaluation, problems: bySeverity(evaluation.problems) };
}

export function allProblems(
  catalog: Catalog,
  index: CatalogIndex,
  rules: readonly ProblemRule[] = resolveRules(currentRuleEntries()),
): Problem[] {
  return evaluateProblems(catalog, index, rules).problems;
}

function bySeverity(found: Problem[]): Problem[] {
  return [
    ...found.filter((p) => p.severity === "error"),
    ...found.filter((p) => p.severity === "warning"),
  ];
}
