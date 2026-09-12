// The problems of the live catalog, for a component.
//
// Five places show the same list - the page, the sidebar badge, the overview,
// the landing's demo, the rules table - and each used to compute it once on
// mount. Now the list depends on the rules in force, which the Settings page
// changes under a running app, so the computation subscribes to them and the
// five places re-render together when a switch is flipped.

import { useMemo } from "react";
import { catalog, index } from "../data";
import { evaluateProblems } from "./all-problems";
import type { Problem } from "./derive";
import { useProblemRules } from "./problem-rules";
import type { RuleEvaluation } from "./problem-rules";

export function useProblemEvaluation(): RuleEvaluation {
  const rules = useProblemRules();
  return useMemo(() => evaluateProblems(catalog, index, rules), [rules]);
}

export function useProblems(): Problem[] {
  return useProblemEvaluation().problems;
}
