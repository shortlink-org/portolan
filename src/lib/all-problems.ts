// Every reading the catalog makes of itself, in one list.
//
// Five readers, each answering a different question: edges that resolve to
// nothing, producer and consumer schemas that disagree, tables and columns
// that disagree with the model, channels that documents and events do not
// agree on, and what the deployer runs that nobody claims. What they find
// goes through the rules - switched off, re-graded, joined by the manifest's
// own CEL rules - and comes out as problems. The problems page, the overview
// and the landing all want the union, errors first - a boundary leak is not
// the same kind of news as a column whose type has drifted, and mixing them
// buries the first.

import type { Catalog, CatalogIndex } from "../catalog";
import { dataProblems } from "./data-problems";
import { deployProblems } from "./deploy-problems";
import { problems } from "./derive";
import type { Finding, Problem } from "./derive";
import { currentRuleEntries, evaluateRules, resolveRules } from "./problem-rules";
import type { ProblemRule, RuleEvaluation } from "./problem-rules";
import { protoProblems } from "./proto-problems";
import { wireProblems } from "./wire-problems";

/** What the readers found, before any rule has had a say. */
export function allFindings(catalog: Catalog, index: CatalogIndex): Finding[] {
  return [
    ...problems(catalog),
    ...protoProblems(catalog, index),
    ...dataProblems(catalog, index),
    ...wireProblems(catalog, index),
    ...deployProblems(catalog),
  ];
}

/** The findings through the rules, with what the rules had to say about them. */
export function evaluateProblems(
  catalog: Catalog,
  index: CatalogIndex,
  rules: readonly ProblemRule[] = resolveRules(currentRuleEntries()),
): RuleEvaluation {
  const evaluation = evaluateRules(allFindings(catalog, index), catalog, index, rules);
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
