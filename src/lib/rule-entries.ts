// What a switch or a re-grade does to the manifest's entries.
//
// The Rules page and the Problems page both flip a rule; the entry they
// write is one shape, kept here so the two cannot write it differently.

import type { ProblemRule, ProblemRuleEntry, RuleSeverity } from "./problem-rules";

/** The entries with one rule switched. A shipped rule back on with nothing else to say loses its entry. */
export function switched(entries: ProblemRuleEntry[], rule: ProblemRule, enabled: boolean, reason: string): ProblemRuleEntry[] {
  const existing = entries.find((entry) => entry.id === rule.id);
  if (rule.builtin) {
    const next: ProblemRuleEntry = { id: rule.id };
    if (!enabled) next.enabled = false;
    if (existing?.severity) next.severity = existing.severity;
    const why = enabled ? existing?.reason : reason || existing?.reason;
    if (why && (!enabled || next.severity)) next.reason = why;
    if (enabled && !next.severity) return entries.filter((entry) => entry.id !== rule.id);
    return existing ? entries.map((entry) => (entry.id === rule.id ? next : entry)) : [...entries, next];
  }
  return entries.map((entry) => {
    if (entry.id !== rule.id) return entry;
    const { enabled: _enabled, ...rest } = entry;
    return enabled ? rest : { ...rest, enabled: false, ...(reason ? { reason } : {}) };
  });
}

/** The entries with one rule's severity set; a shipped rule back at its own severity loses the field. */
export function regraded(entries: ProblemRuleEntry[], rule: ProblemRule, severity: RuleSeverity): ProblemRuleEntry[] {
  const existing = entries.find((entry) => entry.id === rule.id);
  if (rule.builtin) {
    const next: ProblemRuleEntry = { id: rule.id };
    if (existing?.enabled === false) next.enabled = false;
    if (severity !== rule.defaultSeverity) next.severity = severity;
    if (existing?.reason) next.reason = existing.reason;
    if (next.enabled === undefined && !next.severity) return entries.filter((entry) => entry.id !== rule.id);
    return existing ? entries.map((entry) => (entry.id === rule.id ? next : entry)) : [...entries, next];
  }
  return entries.map((entry) => (entry.id === rule.id ? { ...entry, severity } : entry));
}
