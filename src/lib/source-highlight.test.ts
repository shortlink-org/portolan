import { describe, expect, it } from "vitest";
import { highlightSource } from "./source-highlight";

function classes(value: ReturnType<typeof highlightSource>): string[] {
  return value.flatMap((node) => {
    if (node.type === "text") return [];
    const own = node.properties?.className;
    return [
      ...(Array.isArray(own) ? own.filter((item): item is string => typeof item === "string") : []),
      ...classes(node.children),
    ];
  });
}

describe("highlightSource", () => {
  it("tokenises a TypeScript source window", () => {
    const nodes = highlightSource(
      "basket/handlers.ts",
      'export const checkout = async (id: string) => "done";',
    );
    expect(classes(nodes)).toContain("hljs-keyword");
    expect(classes(nodes)).toContain("hljs-string");
  });

  it("keeps unsupported files as plain text", () => {
    expect(highlightSource("schema/catalog.proto", "message Cart {}"))
      .toEqual([{ type: "text", value: "message Cart {}" }]);
  });
});
