export type RuleSubject =
  | "service"
  | "call"
  | "copy"
  | "event"
  | "consumer"
  | "channel"
  | "subscription"
  | "table"
  | "column"
  | "deployment"
  | "flow"
  | "aggregate"
  | "operation";

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

export function ruleExpressionProblems(
  rule: { id: string; over?: string; title?: string; when?: string; message?: string; peer?: string },
  at?: string,
): string[];

/** A row the author wrote down, and what the rule should say about it. */
export interface RuleExample {
  name: string;
  expect: "row" | "none";
  /** Only the fields the rule reads; the rest are zero values. Ints are plain numbers. */
  row: Record<string, unknown>;
  /** The estate lists the rule reads, when it reads any; the rest are empty. */
  estate?: Record<string, string[]>;
}

export const EXPECTATIONS: RuleExample["expect"][];

export function zeroOf(type: FieldType): unknown;

export function rowOfExample(schema: Record<string, FieldType>, written?: unknown, at?: string): Record<string, unknown>;

export function exampleMatches(over: RuleSubject, when: string, example: Pick<RuleExample, "row" | "estate">): boolean;

export function ruleExampleProblems(rule: { id: string; over?: string; when?: string; examples?: unknown }, at?: string): string[];
