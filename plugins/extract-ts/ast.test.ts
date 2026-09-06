import { describe, expect, it } from "vitest";
import { children, docBlock, firstTokenOf, flattenLinks, isClassDecl, isExportNamed, isMethod, isVarDecl, jsdoc, lineOf, parse, paramIdent, parseDoc, stringOf, templateShape, text, typeText, unwrap, walk } from "./ast.ts";
import type { CallExpression, ClassDeclaration, Literal, TemplateLiteral } from "./ast.ts";

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
      if (isVarDecl(n)) {
        const inner = unwrap(n.declarations[0]!.init!);
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
    const lit: Literal = { type: "Literal", value: "a", start: 0, end: 3 };
    expect(stringOf(lit)).toBe("a");
  });
});

describe("the doc comment", () => {
  const p = parse("x.ts", SRC);
  const decl = p.program.body[1]!;
  const cls = (isExportNamed(decl) ? decl.declaration : decl) as ClassDeclaration;

  it("keeps the deprecation beside the prose it was cut from", () => {
    const block = docBlock(p, cls, firstTokenOf(cls, decl));
    expect(block.text).toBe("Class doc.\n\nSecond paragraph.");
    expect(block.deprecated).toBe("not really");
    expect(block.examples).toEqual([]);
    // Nothing above the class itself but the decorator: no block, and no tags.
    expect(docBlock(p, cls)).toEqual({ text: "", examples: [] });
  });

  it("folds @remarks into the text, keeps each @example whole, and drops the tags a type checker reads", () => {
    const block = parseDoc(`
 * One line.
 *
 * @param id which one
 * @remarks
 * The long form, which TSDoc puts here.
 *
 * With a second paragraph.
 * @example
 * const b = Basket.create(id);
 * b.addItem("sku", 1);
 * @returns nothing
 * @example \`\`\`ts
 * fenced();
 * \`\`\`
 * @deprecated
 `);
    expect(block.text).toBe("One line.\n\nThe long form, which TSDoc puts here.\n\nWith a second paragraph.");
    expect(block.examples).toEqual(['const b = Basket.create(id);\nb.addItem("sku", 1);', "```ts\nfenced();\n```"]);
    // A bare tag is still the tag: "" says deprecated, undefined says nothing.
    expect(block.deprecated).toBe("");
    expect(parseDoc(" * Plain.").deprecated).toBeUndefined();
  });

  it("flattens {@link} to what it names or to its label", () => {
    expect(flattenLinks("A {@link Basket} holds a {@link BasketItem|line} and a {@link Money money value}.")).toBe("A Basket holds a line and a money value.");
    expect(flattenLinks("See [the docs]{@link https://example.com/x} and {@linkcode Basket.create}.")).toBe("See the docs and Basket.create.");
    expect(parseDoc(" * @deprecated use {@link Basket.lines} instead").deprecated).toBe("use Basket.lines instead");
  });
});
