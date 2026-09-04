// The syntax tree, as much of it as the extractor looks at.
//
// The parser is oxc-parser: native, fast, and with no TypeScript inside it,
// which is the point - the project's TypeScript is the 7 series, a compiler
// with no syntax tree to offer, and pinning a second copy of 5 beside it for
// the parser alone was a workaround, not a design. oxc hands back an ESTree
// with the TypeScript nodes typescript-eslint would give, and everything the
// modules above need is a handful of node shapes, a way to walk, and the
// text and line of a node. Those are declared here, by hand and minimal, so
// the reading does not move when the parser's own typings do.
import { parseSync } from "oxc-parser";

export interface Node {
  type: string;
  start: number;
  end: number;
}
export interface Identifier extends Node {
  type: "Identifier";
  name: string;
  typeAnnotation?: TypeAnnotation | null;
  decorators?: Decorator[];
}
export interface Literal extends Node {
  type: "Literal";
  value: unknown;
}
export interface TemplateLiteral extends Node {
  type: "TemplateLiteral";
  quasis: { value: { cooked: string | null; raw: string } }[];
  expressions: Node[];
}
export interface MemberExpression extends Node {
  type: "MemberExpression";
  object: Node;
  property: Node;
  computed: boolean;
}
export interface CallExpression extends Node {
  type: "CallExpression";
  callee: Node;
  arguments: Node[];
  typeArguments?: { params: Node[] } | null;
}
export interface NewExpression extends Node {
  type: "NewExpression";
  callee: Node;
  arguments: Node[];
}
export interface Wrapped extends Node {
  type: "AwaitExpression" | "ParenthesizedExpression" | "TSAsExpression" | "TSNonNullExpression" | "TSSatisfiesExpression" | "TSTypeAssertion" | "SpreadElement";
  expression?: Node;
  argument?: Node;
}
export interface AssignmentExpression extends Node {
  type: "AssignmentExpression";
  operator: string;
  left: Node;
  right: Node;
}
export interface BinaryExpression extends Node {
  type: "BinaryExpression";
  operator: string;
  left: Node;
  right: Node;
}
export interface ObjectExpression extends Node {
  type: "ObjectExpression";
  properties: Node[];
}
export interface Property extends Node {
  type: "Property";
  key: Node;
  value: Node;
  computed: boolean;
}
export interface ArrayExpression extends Node {
  type: "ArrayExpression";
  elements: (Node | null)[];
}
export interface ArrayPattern extends Node {
  type: "ArrayPattern";
  elements: (Node | null)[];
}
export interface VariableDeclaration extends Node {
  type: "VariableDeclaration";
  declarations: VariableDeclarator[];
}
export interface VariableDeclarator extends Node {
  type: "VariableDeclarator";
  id: Node;
  init: Node | null;
}
export interface ExpressionStatement extends Node {
  type: "ExpressionStatement";
  expression: Node;
}
export interface ReturnStatement extends Node {
  type: "ReturnStatement";
  argument: Node | null;
}
export interface BlockStatement extends Node {
  type: "BlockStatement";
  body: Node[];
}
export interface IfStatement extends Node {
  type: "IfStatement";
  test: Node;
  consequent: Node;
  alternate: Node | null;
}
export interface SwitchStatement extends Node {
  type: "SwitchStatement";
  discriminant: Node;
  cases: SwitchCase[];
}
export interface SwitchCase extends Node {
  type: "SwitchCase";
  test: Node | null;
  consequent: Node[];
}
export interface ForEachStatement extends Node {
  type: "ForOfStatement" | "ForInStatement";
  left: Node;
  right: Node;
  body: Node;
}
export interface ForStatement extends Node {
  type: "ForStatement";
  init: Node | null;
  test: Node | null;
  body: Node;
}
export interface WhileStatement extends Node {
  type: "WhileStatement" | "DoWhileStatement";
  test: Node;
  body: Node;
}
export interface TryStatement extends Node {
  type: "TryStatement";
  block: BlockStatement;
  handler: { body: BlockStatement } | null;
  finalizer: BlockStatement | null;
}
export interface TypeAnnotation extends Node {
  type: "TSTypeAnnotation";
  typeAnnotation: Node;
}
export interface TypeReference extends Node {
  type: "TSTypeReference";
  typeName: Node;
}
export interface FunctionNode extends Node {
  type: "FunctionExpression" | "FunctionDeclaration";
  id: Identifier | null;
  params: Node[];
  body: BlockStatement | null;
  returnType: TypeAnnotation | null;
}
export interface MethodDefinition extends Node {
  type: "MethodDefinition";
  key: Node;
  value: FunctionNode;
  kind: "constructor" | "method" | "get" | "set";
  static: boolean;
  computed: boolean;
}
export interface PropertyDefinition extends Node {
  type: "PropertyDefinition";
  key: Node;
  value: Node | null;
  typeAnnotation: TypeAnnotation | null;
  static: boolean;
  computed: boolean;
}
export interface ParameterProperty extends Node {
  type: "TSParameterProperty";
  parameter: Node;
  decorators?: Decorator[];
}
export interface Decorator extends Node {
  type: "Decorator";
  expression: Node;
}
export interface ClassDeclaration extends Node {
  type: "ClassDeclaration" | "ClassExpression";
  id: Identifier | null;
  body: { body: Node[] };
  decorators: Decorator[];
}
export interface ImportDeclaration extends Node {
  type: "ImportDeclaration";
  source: Literal;
  specifiers: ImportSpecifier[];
  importKind: "type" | "value";
}
export interface ImportSpecifier extends Node {
  type: "ImportSpecifier" | "ImportDefaultSpecifier" | "ImportNamespaceSpecifier";
  local: Identifier;
  imported?: Node;
  importKind?: "type" | "value";
}
export interface ExportNamedDeclaration extends Node {
  type: "ExportNamedDeclaration";
  declaration: Node | null;
}
export interface InterfaceDeclaration extends Node {
  type: "TSInterfaceDeclaration";
  id: Identifier;
  body: { body: Node[] };
}
export interface MethodSignature extends Node {
  type: "TSMethodSignature";
  key: Node;
  returnType: TypeAnnotation | null;
}
export interface PropertySignature extends Node {
  type: "TSPropertySignature";
  key: Node;
  typeAnnotation: TypeAnnotation | null;
}
export interface FunctionType extends Node {
  type: "TSFunctionType";
  returnType: TypeAnnotation | null;
}
export interface Program extends Node {
  type: "Program";
  body: Node[];
}
export interface Comment {
  type: "Block" | "Line";
  value: string;
  start: number;
  end: number;
}

/** One parsed file: its tree, its comments, and the text both point into. */
export interface Parsed {
  path: string;
  text: string;
  program: Program;
  comments: Comment[];
  /** Offsets at which each line starts, for turning a position into a line. */
  lines: number[];
}

export function parse(path: string, text: string): Parsed {
  const result = parseSync(path, text, { lang: "ts", sourceType: "module" });
  const lines = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines.push(i + 1);
  return { path, text, program: result.program as unknown as Program, comments: result.comments as Comment[], lines };
}

/** The source of a node, as written. */
export function text(p: Parsed, node: Node): string {
  return p.text.slice(node.start, node.end);
}

/** The 1-based line a position falls on. */
export function lineOf(p: Parsed, offset: number): number {
  let lo = 0;
  let hi = p.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.lines[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * The `/** … *\/` comment that sits right above a node, cleaned the way a
 * reader would read it: the frame and the leading stars gone, and cut off at
 * the first tag, since `@param` is for a tool and the text above it is the
 * doc. `from` is where the node's first token is when something precedes the
 * node itself - a decorator, `export` - and the comment sits above that.
 */
export function jsdoc(p: Parsed, node: Node, from = node.start): string {
  let found: Comment | undefined;
  for (const c of p.comments) {
    if (c.end > from) break;
    if (c.type !== "Block" || !c.value.startsWith("*")) continue;
    if (p.text.slice(c.end, from).trim() === "") found = c;
  }
  if (!found) return "";
  const body = found.value.slice(1);
  const lines = body.split("\n").map((l) => l.replace(/^\s*\*? ?/, ""));
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*@\w/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Where a declaration's first token is: its decorator, its `export`, or itself. */
export function firstTokenOf(node: Node, exportNode?: Node): number {
  let start = exportNode ? Math.min(exportNode.start, node.start) : node.start;
  const decorators = (node as { decorators?: Decorator[] }).decorators ?? [];
  for (const d of decorators) start = Math.min(start, d.start);
  return start;
}

/** Every node under one, depth first, the parent before its children. */
export function walk(node: Node, f: (n: Node) => void): void {
  f(node);
  for (const child of children(node)) walk(child, f);
}

export function* children(node: Node): Iterable<Node> {
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const el of value) if (isNode(el)) yield el;
    } else if (isNode(value)) {
      yield value;
    }
  }
}

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && typeof (v as Node).type === "string" && typeof (v as Node).start === "number";
}

/** The expression under `await`, parentheses, `as`, `satisfies`, `!` and `<T>`. */
export function unwrap(node: Node): Node {
  let n = node;
  for (;;) {
    switch (n.type) {
      case "AwaitExpression":
        n = (n as Wrapped).argument!;
        continue;
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
        n = (n as Wrapped).expression!;
        continue;
      default:
        return n;
    }
  }
}

export const isIdent = (n: Node | null | undefined): n is Identifier => n?.type === "Identifier";
export const isString = (n: Node | null | undefined): n is Literal & { value: string } => n?.type === "Literal" && typeof (n as Literal).value === "string";
export const isNumber = (n: Node | null | undefined): n is Literal & { value: number } => n?.type === "Literal" && typeof (n as Literal).value === "number";
export const isBoolean = (n: Node | null | undefined): n is Literal & { value: boolean } => n?.type === "Literal" && typeof (n as Literal).value === "boolean";
export const isTemplate = (n: Node | null | undefined): n is TemplateLiteral => n?.type === "TemplateLiteral";
export const isMember = (n: Node | null | undefined): n is MemberExpression => n?.type === "MemberExpression";
export const isCall = (n: Node | null | undefined): n is CallExpression => n?.type === "CallExpression";
export const isNew = (n: Node | null | undefined): n is NewExpression => n?.type === "NewExpression";
export const isThis = (n: Node | null | undefined): boolean => n?.type === "ThisExpression";
export const isSpread = (n: Node | null | undefined): n is Wrapped => n?.type === "SpreadElement";
export const isAssign = (n: Node | null | undefined): n is AssignmentExpression => n?.type === "AssignmentExpression";
export const isBinary = (n: Node | null | undefined): n is BinaryExpression => n?.type === "BinaryExpression";
export const isObject = (n: Node | null | undefined): n is ObjectExpression => n?.type === "ObjectExpression";
export const isProp = (n: Node | null | undefined): n is Property => n?.type === "Property";
export const isArray = (n: Node | null | undefined): n is ArrayExpression => n?.type === "ArrayExpression";
export const isArrayPattern = (n: Node | null | undefined): n is ArrayPattern => n?.type === "ArrayPattern";
export const isVarDecl = (n: Node | null | undefined): n is VariableDeclaration => n?.type === "VariableDeclaration";
export const isExprStmt = (n: Node | null | undefined): n is ExpressionStatement => n?.type === "ExpressionStatement";
export const isReturn = (n: Node | null | undefined): n is ReturnStatement => n?.type === "ReturnStatement";
export const isThrow = (n: Node | null | undefined): boolean => n?.type === "ThrowStatement";
export const isBlock = (n: Node | null | undefined): n is BlockStatement => n?.type === "BlockStatement";
export const isIf = (n: Node | null | undefined): n is IfStatement => n?.type === "IfStatement";
export const isSwitch = (n: Node | null | undefined): n is SwitchStatement => n?.type === "SwitchStatement";
export const isSwitchCase = (n: Node | null | undefined): n is SwitchCase => n?.type === "SwitchCase";
export const isForEach = (n: Node | null | undefined): n is ForEachStatement => n?.type === "ForOfStatement" || n?.type === "ForInStatement";
export const isFor = (n: Node | null | undefined): n is ForStatement => n?.type === "ForStatement";
export const isWhile = (n: Node | null | undefined): n is WhileStatement => n?.type === "WhileStatement" || n?.type === "DoWhileStatement";
export const isTry = (n: Node | null | undefined): n is TryStatement => n?.type === "TryStatement";
export const isClassDecl = (n: Node | null | undefined): n is ClassDeclaration => n?.type === "ClassDeclaration";
export const isFunctionDecl = (n: Node | null | undefined): n is FunctionNode => n?.type === "FunctionDeclaration";
export const isMethod = (n: Node | null | undefined): n is MethodDefinition => n?.type === "MethodDefinition";
export const isPropertyDef = (n: Node | null | undefined): n is PropertyDefinition => n?.type === "PropertyDefinition";
export const isParamProperty = (n: Node | null | undefined): n is ParameterProperty => n?.type === "TSParameterProperty";
export const isInterface = (n: Node | null | undefined): n is InterfaceDeclaration => n?.type === "TSInterfaceDeclaration";
export const isImport = (n: Node | null | undefined): n is ImportDeclaration => n?.type === "ImportDeclaration";
export const isExportNamed = (n: Node | null | undefined): n is ExportNamedDeclaration => n?.type === "ExportNamedDeclaration";
export const isTypeRef = (n: Node | null | undefined): n is TypeReference => n?.type === "TSTypeReference";
export const isMethodSig = (n: Node | null | undefined): n is MethodSignature => n?.type === "TSMethodSignature";
export const isPropertySig = (n: Node | null | undefined): n is PropertySignature => n?.type === "TSPropertySignature";
export const isFunctionType = (n: Node | null | undefined): n is FunctionType => n?.type === "TSFunctionType";

/** The name a non-computed key or member property carries. */
export function keyName(n: Node): string | undefined {
  if (isIdent(n)) return n.name;
  if (isString(n)) return n.value;
  return undefined;
}

/** `x.name` → "name", when the property is a plain name. */
export function memberName(n: MemberExpression): string | undefined {
  return n.computed ? undefined : keyName(n.property);
}

/** `this.<name>` → name. */
export function thisMember(n: Node): string | undefined {
  return isMember(n) && isThis(n.object) ? memberName(n) : undefined;
}

/** A string literal, or a template with no holes, as its text. */
export function stringOf(n: Node | null | undefined): string | undefined {
  if (isString(n)) return n.value;
  if (isTemplate(n) && n.expressions.length === 0) return n.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

/** `/v1/users/${id}` → `/v1/users/${x}`: a template's holes are parameters. */
export function templateShape(t: TemplateLiteral): string {
  return t.quasis.map((q) => q.value.cooked ?? q.value.raw).join("${x}");
}

/** The binding a parameter declares, through a parameter property, a default or a rest. */
export function paramIdent(param: Node): Identifier | undefined {
  if (isParamProperty(param)) return paramIdent(param.parameter);
  if (param.type === "AssignmentPattern") return paramIdent((param as unknown as { left: Node }).left);
  if (param.type === "RestElement") return paramIdent((param as unknown as { argument: Node }).argument);
  return isIdent(param) ? param : undefined;
}

/** The type a parameter or a property is annotated with, as written, or "". */
export function typeText(p: Parsed, ann: TypeAnnotation | null | undefined): string {
  return ann ? text(p, ann.typeAnnotation) : "";
}
