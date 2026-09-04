import { describe, expect, it } from "vitest";
import { children, firstTokenOf, isClassDecl, isExportNamed, isMethod, jsdoc, lineOf, parse, paramIdent, stringOf, templateShape, text, typeText, unwrap, walk } from "./ast.ts";
import type { CallExpression, ClassDeclaration, TemplateLiteral } from "./ast.ts";

const SRC = `import { inject } from "inversify";
/** Class doc.
 *
 * Second paragraph.
 * @deprecated not really
 */
@injectable()
export class UseCase {
  /** The repo. */
  constructor(@inject(TOKENS.R) private readonly repo: Repo, now: () => Date) {}
  async handle(input: Input): Promise<Out | undefined> {
    const x = await ((this.repo.byId(input.id)) as Basket)!;
    return this.client.GET(\`/v1/users/\${id}/orders\`, {});
  }
}
`;

describe("the adapter", () => {
  const p = parse("x.ts", SRC);
  const decl = p.program.body[1]!;
  const cls = (isExportNamed(decl) ? decl.declaration : decl) as ClassDeclaration;

  it("attaches the doc comment above a decorator and an export, and stops at the first tag", () => {
    expect(isClassDecl(cls)).toBe(true);
    expect(jsdoc(p, cls, firstTokenOf(cls, decl))).toBe("Class doc.\n\nSecond paragraph.");
    // Straight above the class there is only the decorator: no comment there.
    expect(jsdoc(p, cls)).toBe("");
  });

  it("reads a parameter through its property wrapper, and its type as written", () => {
    const ctor = cls.body.body.find((m) => isMethod(m) && m.kind === "constructor");
    if (!ctor || !isMethod(ctor)) throw new Error("no constructor");
    const [repo, now] = ctor.value.params;
    expect(paramIdent(repo!)?.name).toBe("repo");
    expect(typeText(p, paramIdent(repo!)?.typeAnnotation)).toBe("Repo");
    expect(typeText(p, paramIdent(now!)?.typeAnnotation)).toBe("() => Date");
    // The comment sits above the constructor, not above its first parameter.
    expect(jsdoc(p, ctor, firstTokenOf(ctor))).toBe("The repo.");
    expect(jsdoc(p, repo!, firstTokenOf(repo!))).toBe("");
  });

  it("gives text and line the way a reader would open the file", () => {
    const handle = cls.body.body.find((m) => isMethod(m) && m.kind === "method");
    if (!handle || !isMethod(handle)) throw new Error("no handle");
    expect(typeText(p, handle.value.returnType)).toBe("Promise<Out | undefined>");
    expect(lineOf(p, handle.start)).toBe(11);
    expect(text(p, handle.key)).toBe("handle");
  });

  it("unwraps await, parentheses, as and ! down to the call", () => {
    const calls: CallExpression[] = [];
    walk(cls, (n) => {
      if (n.type === "VariableDeclaration") {
        const init = (n as { declarations: { init: import("./ast.ts").Node }[] }).declarations[0]!.init;
        const inner = unwrap(init);
        if (inner.type === "CallExpression") calls.push(inner as CallExpression);
      }
    });
    expect(calls).toHaveLength(1);
    expect(text(p, calls[0]!.callee)).toBe("this.repo.byId");
  });

  it("walks every child once, parent first", () => {
    const seen: string[] = [];
    walk(cls, (n) => seen.push(n.type));
    expect(seen[0]).toBe("ClassDeclaration");
    expect(seen.filter((t) => t === "CallExpression").length).toBeGreaterThanOrEqual(3);
    expect([...children(cls)].map((c) => c.type)).toContain("ClassBody");
  });

  it("reads a template's shape with its holes as parameters", () => {
    let route = "";
    walk(cls, (n) => {
      if (n.type === "TemplateLiteral") route = templateShape(n as TemplateLiteral);
    });
    expect(route).toBe("/v1/users/${x}/orders");
    expect(stringOf({ type: "Literal", value: "a", start: 0, end: 3 })).toBe("a");
  });
});
