import { existsSync, readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import DOMPurify from "dompurify";

// Mermaid's parser loads its browser sanitizer even when it only parses. The
// Node test needs the two no-DOM hooks, while the grammar remains Mermaid's.
DOMPurify.addHook ??= () => {};
DOMPurify.sanitize ??= (value) => value;
const { default: mermaid } = await import("mermaid");

async function markdownFiles() {
  const files = [];
  for await (const file of glob("docs/**/*.md")) files.push(file);
  return files.sort();
}

function explicitAnchors(text) {
  return new Set([...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]));
}

describe("generated documentation quality", () => {
  it("has no broken relative files or explicit anchors", async () => {
    const problems = [];
    for (const file of await markdownFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        const target = match[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) continue;
        const [relative, anchor] = target.split("#", 2);
        const destination = relative ? normalize(join(dirname(file), relative)) : file;
        if (!existsSync(destination)) {
          problems.push(`${file}: missing ${target}`);
        } else if (anchor?.startsWith("type-") || anchor?.startsWith("event-") || anchor?.startsWith("relation-") || anchor?.startsWith("step-")) {
          if (!explicitAnchors(readFileSync(destination, "utf8")).has(anchor)) problems.push(`${file}: missing #${anchor} in ${destination}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("parses every generated Mermaid block and standalone diagram", async () => {
    const diagrams = [];
    for (const file of await markdownFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) diagrams.push([file, match[1]]);
    }
    for await (const file of glob("exports/mermaid/*.mmd")) diagrams.push([file, readFileSync(file, "utf8")]);
    expect(diagrams.length).toBeGreaterThan(0);
    for (const [file, diagram] of diagrams) {
      try { await mermaid.parse(diagram); } catch (cause) { throw new Error(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
  });

  it("keeps the standalone Mermaid bundle identical to flow pages", async () => {
    const mismatches = [];
    for await (const file of glob("exports/mermaid/*.mmd")) {
      const slug = file.split("/").at(-1).replace(/\.mmd$/, "");
      const page = readFileSync(`docs/flows/${slug}.md`, "utf8");
      const embedded = /```mermaid\n([\s\S]*?)```/.exec(page)?.[1];
      if (embedded !== readFileSync(file, "utf8")) mismatches.push(slug);
    }
    expect(mismatches).toEqual([]);
  });
});
