export type RuleSubject = "service" | "event" | "channel" | "table" | "deployment" | "flow" | "aggregate" | "call";

export type RuleSeverity = "error" | "warning";

/** A CEL type name, as the schema spells it. */
export type FieldType = "string" | "int" | "bool" | "list<string>";

export interface SubjectDefinition {
  description: string;
  schema: Record<string, FieldType>;
}

export const SUBJECTS: Record<RuleSubject, SubjectDefinition>;
export const ESTATE_SCHEMA: Record<string, FieldType>;
export const SUBJECT_NAMES: RuleSubject[];
export const SEVERITIES: RuleSeverity[];
export const RULE_ID: RegExp;

/** A parsed expression: call it with the context to evaluate. */
export type CompiledExpression = (context: Record<string, unknown>) => unknown;

export function environmentFor(subject: RuleSubject): unknown;

export function compileExpression(subject: RuleSubject, source: string, type: "bool" | "string"): CompiledExpression;

export function problemRuleProblems(entries: unknown, builtinIds: Iterable<string>, path?: string): string[];
