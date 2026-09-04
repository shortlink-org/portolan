import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../data";
import { flowMermaid } from "./mermaid";

/** The fenced mermaid block of a generated flow page. */
function generated(slug: string): string {
  const page = readFileSync(`docs/flows/${slug}.md`, "utf8");
  const match = /```mermaid\n([\s\S]*?)```/.exec(page);
  if (!match) throw new Error(`no mermaid block in docs/flows/${slug}.md`);
  return match[1]!;
}

describe("flowMermaid", () => {
  // The Go generator and this port draw the same diagram, or one of them is
  // wrong; the generated pages are the record of what the Go one drew.
  it.each(catalog.flows.map((f) => f.slug))("draws %s as gen-markdown does", (slug) => {
    const flow = catalog.flows.find((f) => f.slug === slug)!;
    expect(flowMermaid(flow)).toBe(generated(slug));
  });
});
